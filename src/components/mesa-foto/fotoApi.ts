import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  chamarFuncao,
  ErroDaMesa,
  extensao,
  padraoPara,
  type ModeloIa,
  type ParteDaEstimativa,
  type Qualidade,
} from "@/lib/mesa/api";
import { invalidarAcervo } from "@/components/mesa/contextoDoCliente";
import { novoId } from "@/components/mesa/EstudioFotos";

/**
 * Mesa Foto: a ponte da tela com a função mesa-foto e as tabelas
 * cliente_imagens, foto_kits, foto_kit_refs e foto_ensaios
 * (docs/mesa-foto/CONTRATO.md). A função é chamada pelo mesmo caminho da
 * Mesa (chamarFuncao), com o erro já traduzido para gente.
 *
 * Os normalizadores aceitam campo faltando ou em outra forma: a função está
 * sendo escrita em paralelo e o banco pode ainda não ter as colunas novas.
 * Tudo o que vai para o cache do TanStack é JSON puro (o cache da Mesa vai
 * para o navegador).
 */

// ------------------------------------------------------------------ tipos

export type TipoDoKit = "produto" | "pessoa" | "alimento" | "bebida" | "cosmetico" | "moda" | "tecnologia" | "outro";
export type PapelDaRef = "identidade" | "detalhe" | "embalagem" | "verso" | "rotulo" | "rosto" | "corpo" | "pose" | "estilo" | "cenario";
export type ModoDaFoto = "preservar" | "luz_cor" | "cenario" | "angulo" | "ensaio" | "canvas" | "detalhe" | "clone";
export type ModoDePreparo = "fundo_branco" | "fundo_transparente" | "cenario" | "luz_cor" | "limpar";
export type ClasseDaFoto = "original" | "derivada" | "gerada";
export type Enquadramento = "detalhe" | "medio" | "aberto";
export type Destino = "arquivos" | "aprovacao";

export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Foto do acervo único do cliente (cliente_imagens), com as colunas da Mesa Foto. */
export interface FotoDoAcervo {
  id: string;
  client_id: string;
  nome: string;
  storage_bucket: string;
  storage_path: string;
  origem: string;
  pasta: string | null;
  categoria: string | null;
  tags: string[];
  descricao: string | null;
  ativa: boolean;
  derivada_de: string | null;
  gerada: boolean;
  modo: ModoDaFoto | null;
  kit_id: string | null;
  aprovada: boolean;
  largura: number | null;
  altura: number | null;
  criado_em: string;
  /** Foto oficial ou de loja baixada da internet (produto_identificar): uso interno para fidelidade, nunca vai ao cliente. */
  referencia_web: boolean;
}

export interface Atributos {
  observado: string[];
  informado: string[];
  inferido: string[];
}

export interface AutorizacaoDoKit {
  confirmada: boolean;
  quem: string;
  data: string;
  finalidade: string;
  observacao: string;
}

/** De onde veio uma referência da internet (página oficial ou loja). */
export interface OrigemWeb {
  url: string;
  fonte: string;
  pagina: string;
}

export interface RefDoKit {
  imagem_id: string;
  papel: PapelDaRef;
  vista: string;
  prioridade: number;
  /** Referência da internet: uso interno para fidelidade, não publicar. */
  origem_web?: OrigemWeb | null;
}

export interface KitDeFoto {
  id: string | null;
  client_id: string;
  tipo: TipoDoKit;
  nome: string;
  variante: string;
  atributos: Atributos;
  invariantes: string[];
  lacunas: string[];
  autorizacao: AutorizacaoDoKit | null;
  frente_imagem_id: string | null;
  status: string;
  atualizado_em: string | null;
  refs: RefDoKit[];
}

export interface PropostaDeKit extends KitDeFoto {
  /** Perguntas pontuais da leitura (modelo, variante a confirmar). */
  perguntas: string[];
}

export interface Camera {
  azimute: number;
  elevacao: number;
  enquadramento: Enquadramento;
}

export interface PontoDaConferencia {
  criterio: string;
  /** true fiel, false diverge, null não deu para avaliar (a parte não aparece nas fontes). */
  ok: boolean | null;
  nota: string;
}

export interface Conferencia {
  pontos: PontoDaConferencia[];
  alertas: string[];
  resumo: string;
  /** O Jev viu divergência crítica (só aviso, nunca decide). */
  aviso_jev: boolean;
}

export interface VersaoDaTomada {
  versao: number;
  imagem_id: string | null;
  storage_path: string | null;
  custo_usd: number | null;
  conferencia: Conferencia | null;
  aprovada: boolean;
  rejeitada: boolean;
  motivo_rejeicao: string;
  criado_em: string | null;
}

export type EstadoDaTomada = "pendente" | "bloqueada" | "gerando" | "gerada" | "aprovada" | "rejeitada" | "falhou";

export interface Tomada {
  id: string;
  nome: string;
  camera: Camera | null;
  cenario: string;
  luz: string;
  modo: ModoDaFoto;
  invariantes: string[];
  pode_mudar: string[];
  formato: string;
  status: EstadoDaTomada;
  motivo_bloqueio: string;
  /** Última falha do gerador nesta tomada (status falhou). */
  ultimo_erro: string;
  /** Quando a função marcou "gerando" (se ela mandar); sem isso vale o atualizado_em do ensaio. */
  gerando_desde: string | null;
  /** Tipo da variação (herói em fundo de cor, na mão, flat lay...) ou da foto de campanha. */
  tipo: string;
  props: string[];
  versoes: VersaoDaTomada[];
}

export interface Ensaio {
  id: string;
  client_id: string;
  kit_id: string | null;
  receita_id: string;
  receita_versao: string;
  finalidade: string;
  formatos: string[];
  tomadas: Tomada[];
  custo_usd: number;
  status: string;
  criado_em: string | null;
  atualizado_em: string | null;
  /** direcao do ensaio: conceito, guia de estilo e modelo sintético (campanha). */
  direcao: DirecaoDoEnsaio;
}

export interface GuiaDeEstilo {
  resumo: string;
  paleta: string[];
  luz: string;
  cenarios: string[];
  props: string[];
  enquadramentos: string[];
  clima: string;
  figurino: string;
  evitar: string[];
}

export interface PerfilDoModelo {
  perfil: string;
  idade_aprox: string;
  estilo: string;
}

export interface DirecaoDoEnsaio {
  conceito: string;
  guia_de_estilo: GuiaDeEstilo | null;
  modelo: PerfilDoModelo | null;
  /** A campanha da Mesa que orientou o plano (escolhida ou a do mês). */
  campanha_mesa?: { id: string; nome: string; papel: string } | null;
}

/** Tomada da receita: o id é o que ensaio_planejar aceita em tomadas_pedidas. */
export interface TomadaDaReceita {
  id: string;
  nome: string;
}

export interface Receita {
  id: string;
  nome: string;
  tipo: string;
  /** Tipos de kit que a receita aceita (a função recusa os outros com receita_incompativel). */
  tipos_de_kit: TipoDoKit[];
  direcao: string;
  tomadas: TomadaDaReceita[];
  atributos_criticos: string[];
  versao: string;
}

export interface LeituraDaFoto {
  descricao: string;
  observado: string[];
  texto_lido: string;
  qualidade: { nitidez: string; luz: string; enquadramento: string; problemas: string[] };
  sugestao: { tipo: string; nome: string; papel: string } | null;
}

// ------------------------------------------------------------------ rótulos

export const TIPOS_DE_KIT: { valor: TipoDoKit; rotulo: string }[] = [
  { valor: "produto", rotulo: "Produto" },
  { valor: "pessoa", rotulo: "Pessoa" },
  { valor: "alimento", rotulo: "Alimento" },
  { valor: "bebida", rotulo: "Bebida" },
  { valor: "cosmetico", rotulo: "Cosmético" },
  { valor: "moda", rotulo: "Moda" },
  { valor: "tecnologia", rotulo: "Tecnologia" },
  { valor: "outro", rotulo: "Outro" },
];

export const PAPEIS_DA_REF: { valor: PapelDaRef; rotulo: string; dica: string }[] = [
  { valor: "identidade", rotulo: "Identidade", dica: "A foto que prova como o assunto é. Vem primeiro na geração." },
  { valor: "detalhe", rotulo: "Detalhe", dica: "Parte que precisa sair igual: logo, botão, costura, ingrediente." },
  { valor: "embalagem", rotulo: "Embalagem", dica: "Caixa ou pacote. Embalagem não é o produto." },
  { valor: "verso", rotulo: "Verso", dica: "O lado de trás documentado." },
  { valor: "rotulo", rotulo: "Rótulo", dica: "Texto e rótulo legíveis." },
  { valor: "rosto", rotulo: "Rosto", dica: "Rosto da pessoa, só com autorização." },
  { valor: "corpo", rotulo: "Corpo", dica: "Meio corpo ou corpo inteiro da pessoa." },
  { valor: "pose", rotulo: "Pose", dica: "Só a pose. O rosto desta foto não passa para a final." },
  { valor: "estilo", rotulo: "Estilo", dica: "Referência de luz, cor e clima. Não é o assunto." },
  { valor: "cenario", rotulo: "Cenário", dica: "Lugar ou fundo desejado. Não é o assunto." },
];

/**
 * Vistas que a função aceita em foto_kit_refs.vista (a mesma lista do banco).
 * A vista decide se a tomada é novo ângulo ou vista documentada, e a ordem
 * das fontes: texto livre aqui seria jogado fora em silêncio.
 */
export const VISTAS_DA_REF: { valor: string; rotulo: string }[] = [
  { valor: "frente", rotulo: "Frente" },
  { valor: "tres_quartos_direito", rotulo: "Três quartos direito" },
  { valor: "lateral_direita", rotulo: "Lateral direita" },
  { valor: "posterior_direito", rotulo: "Posterior direito" },
  { valor: "verso", rotulo: "Verso" },
  { valor: "posterior_esquerdo", rotulo: "Posterior esquerdo" },
  { valor: "lateral_esquerda", rotulo: "Lateral esquerda" },
  { valor: "tres_quartos_esquerdo", rotulo: "Três quartos esquerdo" },
  { valor: "topo", rotulo: "De cima" },
  { valor: "base", rotulo: "De baixo" },
  { valor: "detalhe", rotulo: "Detalhe" },
  { valor: "livre", rotulo: "Outra vista" },
];

/** Vista aceita pela função ou vazio (sem vista marcada). */
export function vistaValida(v: unknown): string {
  const t = typeof v === "string" ? v.trim() : "";
  return VISTAS_DA_REF.some((x) => x.valor === t) ? t : "";
}

export const rotuloDoTipo = (t?: string | null) => (TIPOS_DE_KIT.find((x) => x.valor === t) || { rotulo: t ? String(t) : "Sem tipo" }).rotulo;
export const rotuloDoPapel = (p?: string | null) => (PAPEIS_DA_REF.find((x) => x.valor === p) || { rotulo: p ? String(p) : "Sem papel" }).rotulo;

export const MODOS_DA_FOTO: Record<ModoDaFoto, { rotulo: string; dica: string }> = {
  preservar: { rotulo: "Preservar", dica: "Máscara e pixels originais de volta no assunto." },
  luz_cor: { rotulo: "Luz e cor", dica: "Trata luz e cor sem mudar o assunto." },
  cenario: { rotulo: "Novo cenário", dica: "Troca o fundo e o lugar; o assunto fica." },
  angulo: { rotulo: "Novo ângulo", dica: "Gera partes que não aparecem nas fotos. Sem garantia de fidelidade." },
  ensaio: { rotulo: "Ensaio", dica: "Tomada gerada a partir do kit." },
  canvas: { rotulo: "Canvas", dica: "Gerada no Canvas: produto, persona e ambiente juntos." },
  detalhe: { rotulo: "Detalhe 4K", dica: "Re-renderizada em 4K: versão nova, pode mexer em traço fino." },
  clone: { rotulo: "Clone", dica: "Pessoa real recriada por IA a partir das fotos dela, com autorização." },
};

export const rotuloDoModo = (m?: string | null) => (m && (MODOS_DA_FOTO as any)[m] ? MODOS_DA_FOTO[m as ModoDaFoto].rotulo : m ? String(m) : "");

export const MODOS_DE_PREPARO: { valor: ModoDePreparo; rotulo: string; muda: string; fica: string }[] = [
  {
    valor: "limpar",
    rotulo: "Preservar e limpar",
    muda: "Poeira, reflexo estranho e objetos soltos fora das áreas protegidas.",
    fica: "O assunto com os pixels originais.",
  },
  {
    valor: "fundo_branco",
    rotulo: "Fundo branco",
    muda: "O fundo vira branco de catálogo, com sombra de contato.",
    fica: "O assunto recortado, com os pixels originais.",
  },
  {
    valor: "fundo_transparente",
    rotulo: "Tirar fundo",
    muda: "O fundo sai (PNG com transparência). Do gerador vem só o contorno.",
    fica: "O assunto com os pixels originais da foto, sem retoque.",
  },
  {
    valor: "cenario",
    rotulo: "Novo cenário",
    muda: "O lugar em volta do assunto, do jeito que você descrever.",
    fica: "O assunto e as áreas protegidas com os pixels originais.",
  },
  {
    valor: "luz_cor",
    rotulo: "Luz e cor",
    muda: "Exposição, balanço de branco e contraste.",
    fica: "Forma, texto, rosto e proporção. Cor de material não é inventada.",
  },
];

export const FINALIDADES: { valor: string; rotulo: string }[] = [
  { valor: "catalogo", rotulo: "Catálogo e loja" },
  { valor: "anuncio", rotulo: "Anúncio" },
  { valor: "redes", rotulo: "Redes sociais" },
  { valor: "site", rotulo: "Site" },
  { valor: "cardapio", rotulo: "Cardápio e delivery" },
  { valor: "perfil", rotulo: "Perfil profissional" },
];

/** Os formatos que a função aceita (receitas.ts FORMATOS e o check de foto_ensaios.formatos). */
export const FORMATOS: { valor: string; rotulo: string; proporcao: number }[] = [
  { valor: "1:1", rotulo: "1:1 quadrado", proporcao: 1 },
  { valor: "4:5", rotulo: "4:5 feed", proporcao: 0.8 },
  { valor: "9:16", rotulo: "9:16 stories", proporcao: 0.5625 },
  { valor: "16:9", rotulo: "16:9 banner", proporcao: 1.7778 },
  { valor: "2:3", rotulo: "2:3 catálogo em pé", proporcao: 0.6667 },
  { valor: "3:2", rotulo: "3:2 catálogo deitado", proporcao: 1.5 },
];

export const proporcaoDoFormato = (f?: string | null) => {
  const achado = FORMATOS.find((x) => x.valor === f);
  return achado ? achado.proporcao : 1;
};

export const AZIMUTES: { graus: number; rotulo: string }[] = [
  { graus: 0, rotulo: "Frente" },
  { graus: 45, rotulo: "Três quartos direito" },
  { graus: 90, rotulo: "Lateral direita" },
  { graus: 135, rotulo: "Posterior direito" },
  { graus: 180, rotulo: "Verso" },
  { graus: 225, rotulo: "Posterior esquerdo" },
  { graus: 270, rotulo: "Lateral esquerda" },
  { graus: 315, rotulo: "Três quartos esquerdo" },
];

export const ELEVACOES: { graus: number; rotulo: string }[] = [
  { graus: -30, rotulo: "Câmera baixa" },
  { graus: 0, rotulo: "Na altura" },
  { graus: 30, rotulo: "Elevada" },
  { graus: 60, rotulo: "Vista alta" },
];

export const ENQUADRAMENTOS: { valor: Enquadramento; rotulo: string }[] = [
  { valor: "detalhe", rotulo: "Detalhe" },
  { valor: "medio", rotulo: "Médio" },
  { valor: "aberto", rotulo: "Aberto" },
];

export function rotuloDaCamera(c: Camera | null | undefined): string {
  if (!c) return "Vista da foto de referência";
  const a = AZIMUTES.find((x) => x.graus === c.azimute);
  const e = ELEVACOES.find((x) => x.graus === c.elevacao);
  const q = ENQUADRAMENTOS.find((x) => x.valor === c.enquadramento);
  return [a ? a.rotulo : `${c.azimute} graus`, e ? e.rotulo : `${c.elevacao} graus`, q ? q.rotulo : c.enquadramento].join(" · ");
}

/** Muda a vista em relação à foto de referência (frente na altura não é ângulo novo). */
export const mudaAVista = (c: Camera | null | undefined) => !!c && (c.azimute !== 0 || c.elevacao !== 0);

export const ESTADOS_DA_TOMADA: Record<EstadoDaTomada, { rotulo: string; cor: string }> = {
  pendente: { rotulo: "A gerar", cor: "bg-muted text-muted-foreground" },
  bloqueada: { rotulo: "Falta evidência", cor: "bg-warning/15 text-warning" },
  gerando: { rotulo: "Gerando", cor: "bg-primary/10 text-primary" },
  gerada: { rotulo: "Para revisar", cor: "bg-info/10 text-info" },
  aprovada: { rotulo: "Aprovada", cor: "bg-success/15 text-success" },
  rejeitada: { rotulo: "Rejeitada", cor: "bg-destructive/10 text-destructive" },
  falhou: { rotulo: "Falhou", cor: "bg-destructive/10 text-destructive" },
};

const ESTADOS_DO_ENSAIO: Record<string, string> = {
  rascunho: "Rascunho",
  planejado: "Planejado",
  em_producao: "Em produção",
  gerando: "Gerando",
  em_revisao: "Em revisão",
  revisao: "Em revisão",
  concluido: "Concluído",
  aprovado: "Aprovado",
  arquivado: "Arquivado",
};
export const rotuloDoEstadoDoEnsaio = (s?: string | null) => ESTADOS_DO_ENSAIO[String(s || "")] || (s ? String(s) : "Sem estado");

// ------------------------------------------------------------------ receitas locais

/**
 * Cópia das 8 receitas da função (supabase/functions/mesa-foto/receitas.ts),
 * com os mesmos ids de tomada e os mesmos tipos de kit. A tela lê da função
 * (ação "receitas"); esta cópia só entra quando a função ainda não responde,
 * para o operador ver as tomadas antes de planejar.
 */
const tr = (id: string, nome: string): TomadaDaReceita => ({ id, nome });

export const RECEITAS_LOCAIS: Receita[] = [
  {
    id: "catalogo-fiel",
    nome: "Catálogo fiel",
    tipo: "produto",
    tipos_de_kit: ["produto", "tecnologia", "cosmetico", "moda", "bebida", "outro"],
    direcao: "Fundo neutro, produto original recomposto.",
    tomadas: [
      tr("principal", "Principal limpa"),
      tr("frente", "Frente"),
      tr("tres-quartos", "Três quartos"),
      tr("lateral", "Lateral"),
      tr("verso", "Verso documentado"),
      tr("detalhe", "Detalhe documentado"),
      tr("com-embalagem", "Produto e embalagem"),
      tr("escala", "Escala com medida confirmada"),
    ],
    atributos_criticos: ["Modelo", "Variante", "Cor", "Texto", "Proporção"],
    versao: "mesa-foto-1",
  },
  {
    id: "tecnologia",
    nome: "Tecnologia e acessórios",
    tipo: "produto",
    tipos_de_kit: ["tecnologia", "produto"],
    direcao: "Luz suave lateral, superfícies e reflexos controlados.",
    tomadas: [
      tr("principal", "Principal em três quartos"),
      tr("frente", "Frente"),
      tr("lateral", "Lateral"),
      tr("portas", "Portas documentadas"),
      tr("botoes", "Botões documentados"),
      tr("embalagem", "Embalagem"),
      tr("uso-em-mesa", "Uso em mesa"),
      tr("campanha", "Composição para campanha"),
    ],
    atributos_criticos: ["Conectores", "Câmeras", "Botões", "Tela", "Espessura"],
    versao: "mesa-foto-1",
  },
  {
    id: "cosmeticos",
    nome: "Cosméticos e frascos",
    tipo: "produto",
    tipos_de_kit: ["cosmetico", "produto"],
    direcao: "Luz ampla, rótulo legível, materiais coerentes.",
    tomadas: [
      tr("frasco", "Frasco principal"),
      tr("frasco-e-caixa", "Frasco e caixa"),
      tr("rotulo", "Rótulo"),
      tr("tampa", "Tampa"),
      tr("textura", "Textura documentada"),
      tr("bancada", "Contexto de bancada"),
      tr("campanha", "Cena de campanha"),
    ],
    atributos_criticos: ["Volume", "Rótulo", "Transparência", "Cor", "Quantidade"],
    versao: "mesa-foto-1",
  },
  {
    id: "alimentos",
    nome: "Alimentos e pratos",
    tipo: "alimento",
    tipos_de_kit: ["alimento"],
    direcao: "Textura natural e luz lateral; preservar a receita real.",
    tomadas: [
      tr("principal", "Prato principal"),
      tr("45-graus", "Vista a 45 graus"),
      tr("de-cima", "Vista superior quando adequada"),
      tr("detalhe", "Detalhe real"),
      tr("entrega", "Embalagem de entrega"),
      tr("mesa", "Contexto de mesa"),
    ],
    atributos_criticos: ["Ingredientes", "Porção", "Ponto de preparo", "Cor", "Montagem"],
    versao: "mesa-foto-1",
  },
  {
    id: "bebidas",
    nome: "Bebidas e embalagens",
    tipo: "alimento",
    tipos_de_kit: ["bebida", "alimento"],
    direcao: "Reflexos controlados e escala fiel.",
    tomadas: [
      tr("principal", "Embalagem principal"),
      tr("rotulo", "Rótulo"),
      tr("servida", "Bebida servida documentada"),
      tr("detalhe", "Detalhe"),
      tr("mesa", "Composição de mesa"),
      tr("com-texto", "Cena com espaço para texto"),
    ],
    atributos_criticos: ["Marca", "Volume", "Composição", "Recipiente", "Cor"],
    versao: "mesa-foto-1",
  },
  {
    id: "retrato-profissional",
    nome: "Retrato profissional",
    tipo: "pessoa",
    tipos_de_kit: ["pessoa"],
    direcao: "Pele natural, iluminação suave e roupa coerente.",
    tomadas: [
      tr("frontal", "Retrato frontal"),
      tr("tres-quartos", "Três quartos"),
      tr("meio-corpo", "Meio corpo"),
      tr("sentado", "Sentado"),
      tr("ambiente", "Ambiente profissional"),
      tr("com-texto", "Foto com espaço para texto"),
    ],
    atributos_criticos: ["Identidade", "Idade aparente", "Pele", "Óculos", "Mãos"],
    versao: "mesa-foto-1",
  },
  {
    id: "ensaio-editorial",
    nome: "Ensaio pessoal editorial",
    tipo: "pessoa",
    tipos_de_kit: ["pessoa"],
    direcao: "Variar direção e ambiente com identidade aprovada.",
    tomadas: [
      tr("retrato", "Retrato"),
      tr("meio-corpo", "Meio corpo"),
      tr("corpo-inteiro", "Corpo inteiro"),
      tr("pose", "Pose alternativa"),
      tr("externo", "Ambiente externo"),
      tr("estudio", "Ambiente de estúdio"),
    ],
    atributos_criticos: ["Identidade", "Anatomia", "Expressão", "Cabelo", "Acessórios"],
    versao: "mesa-foto-1",
  },
  {
    id: "moda-acessorios",
    nome: "Moda e acessórios",
    tipo: "produto",
    tipos_de_kit: ["moda", "produto"],
    direcao: "Material, cor e proporção consistentes.",
    tomadas: [
      tr("frente", "Frente"),
      tr("costas", "Costas documentadas"),
      tr("tres-quartos", "Três quartos"),
      tr("material", "Detalhe de material"),
      tr("fecho", "Fecho ou costura"),
      tr("no-corpo", "Escala no corpo"),
      tr("editorial", "Composição editorial"),
    ],
    atributos_criticos: ["Estampa", "Costura", "Cor", "Proporção", "Modelo"],
    versao: "mesa-foto-1",
  },
];

/** A receita aceita o tipo do kit (mesma regra da função: receita_incompativel). */
export function receitaServeParaKit(r: Pick<Receita, "tipos_de_kit">, tipoDoKit: TipoDoKit | null | undefined): boolean {
  if (!tipoDoKit) return true;
  return r.tipos_de_kit.indexOf(tipoDoKit) >= 0;
}

// ------------------------------------------------------------------ normalizadores

const texto = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : typeof v === "number" ? String(v) : "");
const textoOuNulo = (v: unknown): string | null => {
  const t = texto(v).trim();
  return t ? t : null;
};
const numeroOuNulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};
const booleano = (v: unknown) => v === true || v === "true" || v === 1;

/** Lista de textos: aceita lista, texto com quebras de linha ou nada. */
export function listaDeTextos(v: unknown): string[] {
  const saida: string[] = [];
  const por = (t: string) => {
    const limpo = t.trim();
    if (limpo && saida.indexOf(limpo) < 0) saida.push(limpo);
  };
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === "string") por(item);
      else if (item && typeof item === "object") por(texto((item as any).texto || (item as any).nome || (item as any).valor));
    }
  } else if (typeof v === "string") {
    v.split("\n").forEach(por);
  }
  return saida;
}

const MODOS_VALIDOS: ModoDaFoto[] = ["preservar", "luz_cor", "cenario", "angulo", "ensaio", "canvas", "detalhe", "clone"];
const TIPOS_VALIDOS = TIPOS_DE_KIT.map((t) => t.valor);
const PAPEIS_VALIDOS = PAPEIS_DA_REF.map((p) => p.valor);

export function normalizarFoto(bruta: any): FotoDoAcervo | null {
  if (!bruta || typeof bruta !== "object" || !bruta.id) return null;
  const modo = texto(bruta.modo);
  return {
    id: String(bruta.id),
    client_id: texto(bruta.client_id),
    nome: texto(bruta.nome) || texto(bruta.storage_path).split("/").pop() || "Foto",
    storage_bucket: texto(bruta.storage_bucket) || "mesa",
    storage_path: texto(bruta.storage_path),
    origem: texto(bruta.origem) || "upload",
    pasta: textoOuNulo(bruta.pasta),
    categoria: textoOuNulo(bruta.categoria),
    tags: listaDeTextos(bruta.tags),
    descricao: textoOuNulo(bruta.descricao),
    ativa: bruta.ativa === undefined ? true : booleano(bruta.ativa),
    derivada_de: textoOuNulo(bruta.derivada_de),
    gerada: booleano(bruta.gerada),
    modo: MODOS_VALIDOS.indexOf(modo as ModoDaFoto) >= 0 ? (modo as ModoDaFoto) : null,
    kit_id: textoOuNulo(bruta.kit_id),
    aprovada: booleano(bruta.aprovada),
    largura: numeroOuNulo(bruta.largura),
    altura: numeroOuNulo(bruta.altura),
    criado_em: texto(bruta.criado_em),
    referencia_web: ehTagDeWeb(listaDeTextos(bruta.tags), texto(bruta.origem)),
  };
}

/** Tag que a função põe nas imagens baixadas da internet (produto_identificar). */
export const TAG_DA_REFERENCIA_WEB = "referencia_web";
const ehTagDeWeb = (tags: string[], origem: string) => tags.indexOf(TAG_DA_REFERENCIA_WEB) >= 0 || origem === "web" || origem === "referencia_web";

/** Referência da internet: uso interno para fidelidade, nunca vai ao cliente como foto final. */
export const ehReferenciaWeb = (f: Pick<FotoDoAcervo, "referencia_web"> | null | undefined) => !!(f && f.referencia_web);

export const normalizarFotos = (lista: unknown): FotoDoAcervo[] => {
  const saida: FotoDoAcervo[] = [];
  if (Array.isArray(lista)) {
    for (const b of lista) {
      const f = normalizarFoto(b);
      if (f) saida.push(f);
    }
  }
  return saida;
};

/** Original, derivada (tratada a partir de outra) ou gerada (sintética). */
export function classeDaFoto(f: Pick<FotoDoAcervo, "gerada" | "derivada_de" | "modo">): ClasseDaFoto {
  if (f.gerada || f.modo === "angulo" || f.modo === "ensaio" || f.modo === "canvas" || f.modo === "detalhe" || f.modo === "clone") return "gerada";
  if (f.derivada_de) return "derivada";
  return "original";
}

/** Largura dividida pela altura; sem medidas, quadrado. */
export const proporcaoDaFoto = (f: Pick<FotoDoAcervo, "largura" | "altura"> | null | undefined) =>
  f && f.largura && f.altura && f.largura > 0 && f.altura > 0 ? f.largura / f.altura : 1;

function normalizarAtributos(v: any): Atributos {
  const a = v && typeof v === "object" && !Array.isArray(v) ? v : {};
  return { observado: listaDeTextos(a.observado), informado: listaDeTextos(a.informado), inferido: listaDeTextos(a.inferido) };
}

/**
 * Data da autorização: a função só guarda AAAA-MM-DD (outra forma vira nulo
 * lá). A tela mostra e aceita DD/MM/AAAA e converte ao salvar.
 */
export function dataParaIso(t: string): string {
  const limpo = String(t || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(limpo)) return limpo.slice(0, 10);
  const m = limpo.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return "";
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return "";
  return `${m[3]}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export function dataParaTela(t: string): string {
  const m = String(t || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(t || "");
}

function normalizarAutorizacao(v: any): AutorizacaoDoKit | null {
  if (!v || typeof v !== "object") return null;
  return {
    confirmada: booleano(v.confirmada) || booleano(v.autorizado),
    quem: texto(v.quem || v.autorizado_por),
    data: dataParaTela(texto(v.data || v.em)),
    finalidade: texto(v.finalidade),
    observacao: texto(v.observacao),
  };
}

export function normalizarRef(v: any): RefDoKit | null {
  if (!v || typeof v !== "object") return null;
  const id = texto(v.imagem_id || v.id_imagem || v.asset_id);
  if (!id) return null;
  const papel = texto(v.papel || v.role);
  const ref: RefDoKit = {
    imagem_id: id,
    papel: PAPEIS_VALIDOS.indexOf(papel as PapelDaRef) >= 0 ? (papel as PapelDaRef) : "identidade",
    vista: vistaValida(v.vista || v.observed_view),
    prioridade: numeroOuNulo(v.prioridade) === null ? 0 : Number(v.prioridade),
  };
  const web = normalizarOrigemWeb(v.origem_web);
  if (web) ref.origem_web = web;
  return ref;
}

export function normalizarOrigemWeb(v: any): OrigemWeb | null {
  if (!v || typeof v !== "object") return null;
  const url = texto(v.url || v.url_origem || v.imagem_url);
  const pagina = texto(v.pagina || v.pagina_url || v.page);
  const fonte = texto(v.fonte || v.site || v.dominio);
  if (!url && !pagina) return null;
  return { url, fonte, pagina };
}

export function normalizarKit(v: any, refsSoltas: any[] = []): KitDeFoto | null {
  if (!v || typeof v !== "object") return null;
  const tipo = texto(v.tipo || v.kind);
  const refsBrutas = Array.isArray(v.refs) ? v.refs : Array.isArray(v.referencias) ? v.referencias : refsSoltas;
  const refs: RefDoKit[] = [];
  for (const r of refsBrutas) {
    const n = normalizarRef(r);
    if (n && !refs.some((x) => x.imagem_id === n.imagem_id && x.papel === n.papel)) refs.push(n);
  }
  refs.sort((a, b) => a.prioridade - b.prioridade);
  return {
    id: textoOuNulo(v.id),
    client_id: texto(v.client_id),
    tipo: TIPOS_VALIDOS.indexOf(tipo as TipoDoKit) >= 0 ? (tipo as TipoDoKit) : "produto",
    nome: texto(v.nome || v.name) || "Kit sem nome",
    variante: texto(v.variante || v.variant),
    atributos: normalizarAtributos(v.atributos),
    invariantes: listaDeTextos(v.invariantes),
    lacunas: listaDeTextos(v.lacunas || v.unknowns),
    autorizacao: normalizarAutorizacao(v.autorizacao),
    frente_imagem_id: textoOuNulo(v.frente_imagem_id),
    status: texto(v.status) || "rascunho",
    atualizado_em: textoOuNulo(v.atualizado_em || v.criado_em),
    refs,
  };
}

/**
 * Proposta de kit_sugerir. Na v2 a função já grava a proposta como kit
 * rascunho e devolve o id: com id, a proposta É um kit salvo (aparece na
 * lista e na barra); sem id (função antiga), é só uma proposta na tela.
 */
export function normalizarProposta(v: any): PropostaDeKit | null {
  const k = normalizarKit(v);
  if (!k) return null;
  return { ...k, id: textoOuNulo(v && (v.id || v.kit_id)), perguntas: listaDeTextos(v.perguntas || v.confirmar) };
}

/** A resposta de kit_sugerir em qualquer das formas combinadas. */
export function normalizarPropostas(data: any): PropostaDeKit[] {
  const d = data && typeof data === "object" ? data : {};
  const lista = Array.isArray(d.kits) ? d.kits : Array.isArray(d.sugestoes) ? d.sugestoes : Array.isArray(d.propostas) ? d.propostas : d.kit ? [d.kit] : [];
  const saida: PropostaDeKit[] = [];
  for (const b of lista) {
    const p = normalizarProposta(b);
    if (p) saida.push(p);
  }
  return saida;
}

function normalizarCamera(v: any): Camera | null {
  if (!v || typeof v !== "object") return null;
  const az = numeroOuNulo(v.azimute !== undefined ? v.azimute : v.azimute_graus !== undefined ? v.azimute_graus : v.horizontal_angle);
  const el = numeroOuNulo(v.elevacao !== undefined ? v.elevacao : v.elevacao_graus !== undefined ? v.elevacao_graus : v.vertical_angle);
  const enq = texto(v.enquadramento);
  if (az === null && el === null && !enq) return null;
  return {
    azimute: az === null ? 0 : az,
    elevacao: el === null ? 0 : el,
    enquadramento: enq === "detalhe" || enq === "aberto" ? enq : "medio",
  };
}

/**
 * Conferência da versão. A função grava { pendente: true } logo depois de
 * gerar: isso é "ainda não conferida" (null), não uma conferência vazia.
 */
export function normalizarConferencia(v: any): Conferencia | null {
  if (!v || typeof v !== "object" || v.pendente === true) return null;
  const pontos: PontoDaConferencia[] = [];
  if (Array.isArray(v.pontos)) {
    for (const p of v.pontos) {
      if (!p || typeof p !== "object") continue;
      const criterio = texto(p.criterio || p.nome);
      if (!criterio) continue;
      const ok = p.ok === true || p.ok === "true" ? true : p.ok === false || p.ok === "false" ? false : null;
      pontos.push({ criterio, ok, nota: texto(p.nota || p.observacao) });
    }
  }
  const alertas = listaDeTextos(v.alertas);
  const resumo = texto(v.resumo);
  const jev = v.jev && typeof v.jev === "object" ? v.jev : null;
  if (!pontos.length && !alertas.length && !resumo) return null;
  return { pontos, alertas, resumo, aviso_jev: !!(jev && jev.aviso === true) };
}

function normalizarVersao(v: any, i: number): VersaoDaTomada | null {
  if (!v || typeof v !== "object") return null;
  const decisao = texto(v.decisao);
  const motivo = texto(v.motivo_rejeicao || v.motivo);
  // A função grava aprovada true/false/null e decisao "aprovada"/"rejeitada"/null.
  const aprovada = v.aprovada === true || v.aprovada === "true" || decisao === "aprovar" || decisao === "aprovada";
  const rejeitada = !aprovada && (v.aprovada === false || booleano(v.rejeitada) || decisao === "rejeitar" || decisao === "rejeitada" || !!motivo);
  return {
    versao: numeroOuNulo(v.versao) === null ? i + 1 : Number(v.versao),
    imagem_id: textoOuNulo(v.imagem_id),
    storage_path: textoOuNulo(v.storage_path || v.caminho),
    custo_usd: numeroOuNulo(v.custo_usd),
    conferencia: normalizarConferencia(v.conferencia),
    aprovada,
    rejeitada,
    motivo_rejeicao: motivo,
    criado_em: textoOuNulo(v.criado_em),
  };
}

const ESTADOS_VALIDOS: EstadoDaTomada[] = ["pendente", "bloqueada", "gerando", "gerada", "aprovada", "rejeitada", "falhou"];

export function normalizarTomada(v: any, i: number): Tomada | null {
  if (!v || typeof v !== "object") return null;
  const versoes: VersaoDaTomada[] = [];
  if (Array.isArray(v.versoes)) {
    v.versoes.forEach((b: any, j: number) => {
      const n = normalizarVersao(b, j);
      if (n) versoes.push(n);
    });
  }
  versoes.sort((a, b) => a.versao - b.versao);
  const modo = texto(v.modo);
  const bruto = texto(v.status);
  // O status da função manda (ela recalcula o bloqueio com o kit de agora ao gerar);
  // o booleano bloqueada só vale quando o status não veio.
  let status: EstadoDaTomada;
  if (ESTADOS_VALIDOS.indexOf(bruto as EstadoDaTomada) >= 0) status = bruto as EstadoDaTomada;
  else if (booleano(v.bloqueada)) status = "bloqueada";
  else status = "pendente";
  if (status === "pendente" && versoes.length) status = versoes.some((x) => x.aprovada) ? "aprovada" : "gerada";
  return {
    id: texto(v.id) || `tomada-${i + 1}`,
    nome: texto(v.nome) || `Tomada ${i + 1}`,
    camera: normalizarCamera(v.camera),
    cenario: texto(v.cenario),
    luz: texto(v.luz),
    modo: MODOS_VALIDOS.indexOf(modo as ModoDaFoto) >= 0 ? (modo as ModoDaFoto) : "ensaio",
    invariantes: listaDeTextos(v.invariantes),
    pode_mudar: listaDeTextos(v.pode_mudar || v.alteracoes_permitidas),
    formato: texto(v.formato) || "1:1",
    status,
    motivo_bloqueio: texto(v.motivo_bloqueio || v.motivo || v.bloqueio),
    ultimo_erro: texto(v.ultimo_erro),
    gerando_desde: textoOuNulo(v.gerando_desde),
    tipo: texto(v.tipo || v.tipo_variacao || v.variacao),
    props: listaDeTextos(v.props),
    versoes,
  };
}

/** Uma geração não passa disso: tomada em "gerando" há mais tempo caiu no meio. */
export const GERACAO_VENCE_EM_MS = 6 * 60_000;

/**
 * Tomada presa em "gerando" (a função caiu antes de gravar a falha) vira
 * "falhou" depois de 6 minutos, para a equipe poder gerar de novo. A hora vem
 * de gerando_desde; sem ela, do atualizado_em do ensaio (a marca de "gerando"
 * é gravada nele, então é um limite seguro: nunca vence antes da hora).
 */
export function vencerGeracoes(e: Ensaio, agora: number = Date.now()): Ensaio {
  if (!e.tomadas.some((t) => t.status === "gerando")) return e;
  const tomadas = e.tomadas.map((t) => {
    if (t.status !== "gerando") return t;
    const desde = Date.parse(String(t.gerando_desde || e.atualizado_em || ""));
    if (!isFinite(desde) || agora - desde <= GERACAO_VENCE_EM_MS) return t;
    return { ...t, status: "falhou" as EstadoDaTomada, ultimo_erro: t.ultimo_erro || "A geração passou de 6 minutos sem resposta. Gere de novo." };
  });
  return { ...e, tomadas };
}

export function normalizarEnsaio(v: any): Ensaio | null {
  if (!v || typeof v !== "object" || !v.id) return null;
  const tomadas: Tomada[] = [];
  if (Array.isArray(v.tomadas)) {
    v.tomadas.forEach((b: any, i: number) => {
      const t = normalizarTomada(b, i);
      if (t) tomadas.push(t);
    });
  }
  return {
    id: String(v.id),
    client_id: texto(v.client_id),
    kit_id: textoOuNulo(v.kit_id),
    receita_id: texto(v.receita_id),
    receita_versao: texto(v.receita_versao),
    finalidade: texto(v.finalidade),
    formatos: listaDeTextos(v.formatos),
    tomadas,
    custo_usd: numeroOuNulo(v.custo_usd) || 0,
    status: texto(v.status) || "planejado",
    criado_em: textoOuNulo(v.criado_em),
    atualizado_em: textoOuNulo(v.atualizado_em),
    direcao: normalizarDirecao(v.direcao, v),
  };
}

/** Texto de um campo que pode vir como texto ou lista. */
const textoOuLista = (v: unknown): string => (Array.isArray(v) ? listaDeTextos(v).join(", ") : texto(v));

/** Guia de estilo da campanha em qualquer forma (texto solto vira o resumo). */
export function normalizarGuiaDeEstilo(v: any): GuiaDeEstilo | null {
  if (!v) return null;
  if (typeof v === "string") return v.trim() ? { resumo: v.trim(), paleta: [], luz: "", cenarios: [], props: [], enquadramentos: [], clima: "", figurino: "", evitar: [] } : null;
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const g: GuiaDeEstilo = {
    resumo: texto(v.resumo || v.direcao || v.descricao),
    paleta: listaDeTextos(v.paleta || v.cores),
    luz: textoOuLista(v.luz),
    cenarios: listaDeTextos(v.cenarios || v.cenario || v.ambientes),
    props: listaDeTextos(v.props || v.objetos),
    enquadramentos: listaDeTextos(v.enquadramentos || v.enquadramento),
    clima: textoOuLista(v.clima || v.mood),
    figurino: textoOuLista(v.figurino || v.roupa),
    evitar: listaDeTextos(v.evitar || v.nao_fazer),
  };
  const vazio = !g.resumo && !g.luz && !g.clima && !g.figurino && !g.paleta.length && !g.cenarios.length && !g.props.length && !g.enquadramentos.length && !g.evitar.length;
  return vazio ? null : g;
}

export function normalizarPerfilDoModelo(v: any): PerfilDoModelo | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const p = { perfil: texto(v.perfil), idade_aprox: texto(v.idade_aprox || v.idade), estilo: texto(v.estilo) };
  return p.perfil || p.idade_aprox || p.estilo ? p : null;
}

function normalizarDirecao(v: any, ensaio: any): DirecaoDoEnsaio {
  const d = v && typeof v === "object" && !Array.isArray(v) ? v : {};
  const c = d.campanha_mesa && typeof d.campanha_mesa === "object" ? d.campanha_mesa : null;
  const direcao: DirecaoDoEnsaio = {
    conceito: texto(d.conceito),
    guia_de_estilo: normalizarGuiaDeEstilo(d.guia_de_estilo || (ensaio && ensaio.guia_de_estilo)),
    modelo: normalizarPerfilDoModelo(d.modelo || (ensaio && ensaio.modelo)),
  };
  // Só quando o plano veio de uma campanha da Mesa (ensaios antigos não têm).
  if (c && texto(c.id)) direcao.campanha_mesa = { id: texto(c.id), nome: texto(c.nome) || "Campanha", papel: texto(c.papel) };
  return direcao;
}

export function normalizarReceita(v: any): Receita | null {
  if (!v || typeof v !== "object") return null;
  const id = texto(v.id);
  if (!id) return null;
  const local = RECEITAS_LOCAIS.find((r) => r.id === id);
  // A função manda as tomadas como objetos { id, nome, ... }; o id é o que volta em tomadas_pedidas.
  const tomadas: TomadaDaReceita[] = [];
  if (Array.isArray(v.tomadas)) {
    for (const t of v.tomadas) {
      const nome = typeof t === "string" ? t.trim() : t && typeof t === "object" ? texto(t.nome || t.titulo).trim() : "";
      const idDaTomada = t && typeof t === "object" ? texto(t.id).trim() : "";
      if (!nome && !idDaTomada) continue;
      const deLocal = local ? local.tomadas.find((x) => x.nome === nome) : null;
      const final = idDaTomada || (deLocal ? deLocal.id : nome);
      if (!tomadas.some((x) => x.id === final)) tomadas.push({ id: final, nome: nome || final });
    }
  }
  const tiposBrutos = listaDeTextos(v.tipos_de_kit).filter((x) => TIPOS_VALIDOS.indexOf(x as TipoDoKit) >= 0) as TipoDoKit[];
  const tipo = texto(v.tipo) || (local ? local.tipo : tiposBrutos[0] || "produto");
  return {
    id,
    nome: (local && local.nome) || texto(v.nome) || id,
    tipo,
    tipos_de_kit: tiposBrutos.length ? tiposBrutos : local ? local.tipos_de_kit : [tipo as TipoDoKit],
    direcao: texto(v.direcao) || (local ? local.direcao : ""),
    tomadas: tomadas.length ? tomadas : local ? local.tomadas : [],
    atributos_criticos: listaDeTextos(v.atributos_criticos).length ? listaDeTextos(v.atributos_criticos) : local ? local.atributos_criticos : [],
    versao: texto(v.versao || v.receita_versao) || "proposta-1",
  };
}

export function normalizarLeitura(data: any): LeituraDaFoto {
  const d = data && typeof data === "object" ? (data.leitura && typeof data.leitura === "object" ? data.leitura : data) : {};
  const q = d.qualidade && typeof d.qualidade === "object" ? d.qualidade : {};
  const s = d.sugestao && typeof d.sugestao === "object" ? d.sugestao : null;
  return {
    descricao: texto(d.descricao),
    observado: listaDeTextos(d.observado),
    texto_lido: texto(d.texto_lido),
    qualidade: { nitidez: texto(q.nitidez), luz: texto(q.luz), enquadramento: texto(q.enquadramento), problemas: listaDeTextos(q.problemas) },
    sugestao: s ? { tipo: texto(s.tipo), nome: texto(s.nome), papel: texto(s.papel) } : null,
  };
}

/** Quantas duplicadas vieram (número, lista ou nada). */
export function contarDuplicadas(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  const n = numeroOuNulo(v);
  return n === null ? 0 : n;
}

// ------------------------------------------------------------------ leituras

export const chaveDasFotos = (clientId: string) => ["mesa-foto", "acervo", clientId];
export const chaveDosKits = (clientId: string) => ["mesa-foto", "kits", clientId];
export const chaveDosEnsaios = (clientId: string) => ["mesa-foto", "ensaios", clientId];

/** Tabela ainda não publicada no banco: frase clara em vez do erro cru. */
function erroDeTabela(error: any, tabela: string): Error {
  const msg = String((error && error.message) || "");
  const codigo = String((error && error.code) || "");
  if (codigo === "42P01" || codigo === "PGRST205" || msg.indexOf("does not exist") >= 0 || msg.indexOf("Could not find the table") >= 0) {
    return new Error(`O banco da Mesa Foto ainda não foi publicado (tabela ${tabela}). As outras etapas seguem funcionando.`);
  }
  return error instanceof Error ? error : new Error(msg || "Não foi possível ler o banco.");
}

export function useFotos(clientId: string) {
  return useQuery({
    queryKey: chaveDasFotos(clientId),
    enabled: !!clientId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<FotoDoAcervo[]> => {
      const { data, error } = await (supabase as any)
        .from("cliente_imagens")
        .select("*")
        .eq("client_id", clientId)
        .order("criado_em", { ascending: false })
        .limit(3000);
      if (error) throw erroDeTabela(error, "cliente_imagens");
      return normalizarFotos(data);
    },
  });
}

export function useKits(clientId: string) {
  return useQuery({
    queryKey: chaveDosKits(clientId),
    enabled: !!clientId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<KitDeFoto[]> => {
      const { data, error } = await (supabase as any)
        .from("foto_kits")
        .select("*")
        .eq("client_id", clientId)
        .order("atualizado_em", { ascending: false })
        .limit(200);
      if (error) throw erroDeTabela(error, "foto_kits");
      const kits = (data || []) as any[];
      const ids = kits.map((k) => String(k.id));
      let refs: any[] = [];
      if (ids.length) {
        const r = await (supabase as any).from("foto_kit_refs").select("*").in("kit_id", ids);
        if (r.error) throw erroDeTabela(r.error, "foto_kit_refs");
        refs = (r.data || []) as any[];
      }
      const saida: KitDeFoto[] = [];
      for (const k of kits) {
        const n = normalizarKit(k, refs.filter((r) => String(r.kit_id) === String(k.id)));
        if (n) saida.push(n);
      }
      return saida;
    },
  });
}

export function useEnsaios(clientId: string) {
  return useQuery({
    queryKey: chaveDosEnsaios(clientId),
    enabled: !!clientId,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<Ensaio[]> => {
      const { data, error } = await (supabase as any)
        .from("foto_ensaios")
        .select("*")
        .eq("client_id", clientId)
        .order("criado_em", { ascending: false })
        .limit(60);
      if (error) throw erroDeTabela(error, "foto_ensaios");
      const saida: Ensaio[] = [];
      for (const b of (data || []) as any[]) {
        const e = normalizarEnsaio(b);
        if (e) saida.push(e);
      }
      return saida;
    },
    // Na leitura (e não no cache): a hora de agora decide se a geração venceu.
    select: (lista: Ensaio[]) => lista.map((e) => vencerGeracoes(e)),
  });
}

/** Receitas e presets da função; sem resposta, a cópia local da pesquisa. */
export function useReceitas() {
  return useQuery({
    queryKey: ["mesa-foto", "receitas"],
    staleTime: 60 * 60_000,
    retry: false,
    queryFn: async (): Promise<{ receitas: Receita[]; fonte: "funcao" | "local" }> => {
      try {
        const data = await chamarFuncao<any>("mesa-foto", { acao: "receitas" });
        const brutas = data && Array.isArray(data.receitas) ? data.receitas : data && Array.isArray(data.recipes) ? data.recipes : [];
        const versao = texto(data && data.versao);
        const receitas: Receita[] = [];
        for (const b of brutas) {
          const r = normalizarReceita(b && typeof b === "object" && versao && !b.versao ? { ...b, versao } : b);
          if (r) receitas.push(r);
        }
        if (receitas.length) return { receitas, fonte: "funcao" };
      } catch {
        /* função ainda não publicada: vale a cópia local */
      }
      return { receitas: RECEITAS_LOCAIS, fonte: "local" };
    },
  });
}

/** Relê o acervo nas três mesas (Mesa, Mesa Ads e Mesa Foto). */
export function invalidarFotos(queryClient: QueryClient, clientId: string) {
  void queryClient.invalidateQueries({ queryKey: chaveDasFotos(clientId) });
  invalidarAcervo(queryClient, clientId);
  // "Fotos da Mesa Foto" no Estúdio (EstudioFotos, chaveDaMesaFoto): a foto aprovada agora aparece já.
  void queryClient.invalidateQueries({ queryKey: ["mesa", "acervo-mesa-foto", clientId] });
}

/** Põe fotos novas no topo do acervo em cache (antes da releitura chegar). */
export function acrescentarFotos(queryClient: QueryClient, clientId: string, novas: FotoDoAcervo[]) {
  if (!novas.length) return;
  queryClient.setQueryData<FotoDoAcervo[]>(chaveDasFotos(clientId), (lista) => {
    const atual = lista || [];
    const fora = novas.filter((n) => !atual.some((f) => f.id === n.id));
    return fora.concat(atual.map((f) => novas.find((n) => n.id === f.id) || f));
  });
}

/** Troca um ensaio no cache (resposta de tomada_gerar, versao_decidir etc.). */
export function guardarEnsaio(queryClient: QueryClient, clientId: string, ensaio: Ensaio) {
  queryClient.setQueryData<Ensaio[]>(chaveDosEnsaios(clientId), (lista) => {
    const atual = lista || [];
    const achou = atual.some((e) => e.id === ensaio.id);
    return achou ? atual.map((e) => (e.id === ensaio.id ? ensaio : e)) : [ensaio].concat(atual);
  });
}

// ------------------------------------------------------------------ ações

/** Fotos que a função não registrou (tipo pelo conteúdo, arquivo corrompido, repetida no lote). */
export function normalizarRecusadas(v: unknown, caminhos: string[], nomes: string[]): { nome: string; motivo: string }[] {
  const saida: { nome: string; motivo: string }[] = [];
  if (!Array.isArray(v)) return saida;
  for (const r of v) {
    if (!r || typeof r !== "object") continue;
    const caminho = texto((r as any).caminho);
    const i = caminhos.indexOf(caminho);
    const nome = i >= 0 && nomes[i] ? nomes[i] : caminho.split("/").pop() || "foto";
    saida.push({ nome, motivo: texto((r as any).mensagem) || texto((r as any).motivo) || "não entrou no acervo" });
  }
  return saida;
}

export async function registrarNoAcervo(
  clientId: string,
  caminhos: string[],
  nomes: string[],
): Promise<{ imagens: FotoDoAcervo[]; duplicadas: number; recusadas: { nome: string; motivo: string }[] }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "acervo_registrar", client_id: clientId, caminhos, nomes });
  return {
    imagens: normalizarFotos(data && data.imagens),
    duplicadas: contarDuplicadas(data && data.duplicadas),
    recusadas: normalizarRecusadas(data && data.recusadas, caminhos, nomes),
  };
}

/**
 * Aprova (ou tira a aprovação de) uma foto do acervo: a derivada do Preparar
 * só vai para a aprovação do cliente depois da aprovação da equipe.
 */
export async function decidirFoto(clientId: string, imagemId: string, decisao: "aprovar" | "rejeitar"): Promise<FotoDoAcervo | null> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "acervo_decidir", client_id: clientId, imagem_id: imagemId, decisao });
  return normalizarFoto(data && data.imagem);
}

export async function lerFoto(clientId: string, imagemId: string): Promise<LeituraDaFoto & { custo_usd?: number }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "acervo_ler_foto", client_id: clientId, imagem_id: imagemId });
  return { ...normalizarLeitura(data), custo_usd: data && data.custo_usd };
}

/** A função lê no máximo 12 fotos por sugestão (fotos_demais acima disso). */
export const MAX_FOTOS_NA_SUGESTAO = 12;

export async function sugerirKit(
  clientId: string,
  imagemIds: string[],
  extras?: { produto?: ProdutoIdentificado | null; referenciasWeb?: ReferenciaDaWeb[] },
): Promise<{ propostas: PropostaDeKit[]; nao_agrupadas: { imagem_id: string; motivo: string }[]; kit_ids: string[]; aviso: string; custo_usd?: number }> {
  const corpo: Record<string, unknown> = { acao: "kit_sugerir", client_id: clientId, imagem_ids: imagemIds };
  // Depois de produto_identificar: o produto lido e as referências da internet vão junto para o kit.
  if (extras && extras.produto) corpo.produto = extras.produto;
  if (extras && extras.referenciasWeb && extras.referenciasWeb.length) {
    corpo.referencias_web = extras.referenciasWeb.map((r) => ({ imagem_id: r.imagem_id, url_origem: r.url_origem, pagina: r.pagina, fonte: r.fonte }));
  }
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  const nao: { imagem_id: string; motivo: string }[] = [];
  if (data && Array.isArray(data.nao_agrupadas)) {
    for (const x of data.nao_agrupadas) {
      const id = texto(x && x.imagem_id);
      if (id) nao.push({ imagem_id: id, motivo: texto(x.motivo) });
    }
  }
  const propostas = normalizarPropostas(data);
  const ids = listaDeTextos(data && data.kit_ids);
  propostas.forEach((p) => {
    if (p.id && ids.indexOf(p.id) < 0) ids.push(p.id);
  });
  return { propostas, nao_agrupadas: nao, kit_ids: ids, aviso: texto(data && data.aviso), custo_usd: data && data.custo_usd };
}

/** Corpo do kit_salvar: o kit sem as refs (vão à parte), listas limpas. */
export function corpoDoKit(kit: KitDeFoto) {
  const k: Record<string, unknown> = {
    tipo: kit.tipo,
    nome: kit.nome.trim(),
    variante: kit.variante.trim() || null,
    atributos: {
      observado: listaDeTextos(kit.atributos.observado),
      informado: listaDeTextos(kit.atributos.informado),
      inferido: listaDeTextos(kit.atributos.inferido),
    },
    invariantes: listaDeTextos(kit.invariantes),
    lacunas: listaDeTextos(kit.lacunas),
    autorizacao: kit.tipo === "pessoa" && kit.autorizacao ? { ...kit.autorizacao, data: dataParaIso(kit.autorizacao.data) || null } : null,
    // A frente precisa estar entre as referências (a função recusa com frente_fora_do_kit).
    frente_imagem_id: kit.frente_imagem_id && kit.refs.some((r) => r.imagem_id === kit.frente_imagem_id) ? kit.frente_imagem_id : null,
    status: STATUS_DO_KIT.indexOf(kit.status) >= 0 ? kit.status : "rascunho",
  };
  if (kit.id) k.id = kit.id;
  return k;
}

/** Os estados de kit que o banco aceita. */
export const STATUS_DO_KIT = ["rascunho", "confirmado", "arquivado"];

export const refsParaSalvar = (refs: RefDoKit[]) =>
  refs.map((r, i) => {
    const saida: Record<string, unknown> = { imagem_id: r.imagem_id, papel: r.papel, vista: vistaValida(r.vista) || null, prioridade: i };
    // Referência da internet leva a fonte junto (uso interno para fidelidade).
    if (r.origem_web) saida.origem_web = { url: r.origem_web.url, fonte: r.origem_web.fonte, pagina: r.origem_web.pagina };
    return saida;
  });

/** Kit de pessoa só salva com a autorização confirmada (regra dura da casa). */
export function faltaAutorizacao(kit: Pick<KitDeFoto, "tipo" | "autorizacao">): boolean {
  return kit.tipo === "pessoa" && !(kit.autorizacao && kit.autorizacao.confirmada);
}

export async function salvarKit(clientId: string, kit: KitDeFoto): Promise<KitDeFoto> {
  const data = await chamarFuncao<any>("mesa-foto", {
    acao: "kit_salvar",
    client_id: clientId,
    kit: corpoDoKit(kit),
    refs: refsParaSalvar(kit.refs),
  });
  const salvo = normalizarKit(data && data.kit, data && Array.isArray(data.refs) ? data.refs : kit.refs);
  return salvo || kit;
}

export async function planejarEnsaio(p: {
  clientId: string;
  kitId: string;
  receitaId: string;
  finalidade: string;
  formatos: string[];
  pedido: string;
  /** Ids das tomadas da receita que a equipe manteve (vazio: todas). A função recusa id que não é da receita. */
  tomadasPedidas: string[];
  /** Campanha da Mesa (id ou "nenhuma"); sem ela, a função usa a do mês. */
  campanhaId?: string | null;
}): Promise<{ ensaio: Ensaio | null; estimativa_usd: number | null; custo_usd?: number }> {
  const data = await chamarFuncao<any>("mesa-foto", {
    campanha_id: p.campanhaId || undefined,
    acao: "ensaio_planejar",
    client_id: p.clientId,
    kit_id: p.kitId,
    receita_id: p.receitaId,
    finalidade: p.finalidade,
    formatos: p.formatos,
    pedido: p.pedido.trim() || undefined,
    tomadas_pedidas: p.tomadasPedidas.length ? p.tomadasPedidas : undefined,
  });
  return { ensaio: normalizarEnsaio(data && data.ensaio), estimativa_usd: numeroOuNulo(data && data.estimativa_usd), custo_usd: data && data.custo_usd };
}

export async function gerarTomada(p: {
  ensaioId: string;
  tomadaId: string;
  modeloImagemId?: string | null;
  qualidade?: Qualidade;
  camera?: Camera | null;
  guia?: Guia | null;
}): Promise<{ ensaio: Ensaio | null; versao: VersaoDaTomada | null; custo_usd?: number }> {
  const corpo: Record<string, unknown> = { acao: "tomada_gerar", ensaio_id: p.ensaioId, tomada_id: p.tomadaId, guia: guiaParaEnviar(p.guia) };
  if (p.modeloImagemId) corpo.modelo_imagem_id = p.modeloImagemId;
  if (p.qualidade) corpo.qualidade = p.qualidade;
  if (p.camera) corpo.camera = p.camera;
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  return { ensaio: normalizarEnsaio(data && data.ensaio), versao: normalizarVersao(data && data.versao, 0), custo_usd: data && data.custo_usd };
}

/**
 * tomada_editar (sem IA): a função remonta a tomada com o kit de agora, e
 * com isso recalcula modo e bloqueio. Serve para liberar uma tomada que
 * ficou bloqueada no plano depois que a equipe completou o kit.
 */
export async function editarTomada(
  ensaioId: string,
  tomadaId: string,
  campos: { nome?: string; objetivo?: string; preset_id?: string; cenario?: string; luz?: string; formato?: string; pode_mudar?: string[] },
): Promise<{ ensaio: Ensaio | null; tomada: Tomada | null; estimativa_usd: number | null }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "tomada_editar", ensaio_id: ensaioId, tomada_id: tomadaId, campos });
  return { ensaio: normalizarEnsaio(data && data.ensaio), tomada: normalizarTomada(data && data.tomada, 0), estimativa_usd: numeroOuNulo(data && data.estimativa_usd) };
}

export async function prepararFoto(p: {
  clientId: string;
  imagemId: string;
  modo: ModoDePreparo;
  areas: Area[];
  cenario: string;
  instrucao: string;
  guia?: Guia | null;
}): Promise<{ imagem: FotoDoAcervo | null; custo_usd?: number }> {
  const corpo: Record<string, unknown> = { acao: "preparar", client_id: p.clientId, imagem_id: p.imagemId, modo: p.modo, guia: guiaParaEnviar(p.guia) };
  if (p.areas.length) corpo.areas_protegidas = p.areas;
  if (p.modo === "cenario" && p.cenario.trim()) corpo.cenario = p.cenario.trim();
  if (p.instrucao.trim()) corpo.instrucao = p.instrucao.trim();
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  return { imagem: normalizarFoto(data && data.imagem), custo_usd: data && data.custo_usd };
}

export async function conferirVersao(ensaioId: string, tomadaId: string, versao: number): Promise<{ conferencia: Conferencia | null; ensaio: Ensaio | null; custo_usd?: number }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "versao_conferir", ensaio_id: ensaioId, tomada_id: tomadaId, versao });
  return { conferencia: normalizarConferencia(data && data.conferencia), ensaio: normalizarEnsaio(data && data.ensaio), custo_usd: data && data.custo_usd };
}

export async function decidirVersao(p: {
  ensaioId: string;
  tomadaId: string;
  versao: number;
  decisao: "aprovar" | "rejeitar";
  motivo?: string;
}): Promise<{ ensaio: Ensaio | null; imagem: FotoDoAcervo | null }> {
  const corpo: Record<string, unknown> = { acao: "versao_decidir", ensaio_id: p.ensaioId, tomada_id: p.tomadaId, versao: p.versao, decisao: p.decisao };
  if (p.motivo && p.motivo.trim()) corpo.motivo = p.motivo.trim();
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  return { ensaio: normalizarEnsaio(data && data.ensaio), imagem: normalizarFoto(data && data.imagem) };
}

/** Limites da função por chamada: enviar aceita até 30 fotos, baixar até 100. */
export const LOTE_DO_ENVIO = 30;
export const LOTE_DO_BAIXAR = 100;

export function emLotes<T>(lista: T[], tamanho: number): T[][] {
  const saida: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
  return saida;
}

/** Envia em lotes de 30; o aviso da função (revisão não pedida) volta junto. */
export async function enviarFotos(clientId: string, imagemIds: string[], destino: Destino): Promise<{ file_ids: string[]; aviso: string }> {
  const ids: string[] = [];
  const avisos: string[] = [];
  for (const lote of emLotes(imagemIds, LOTE_DO_ENVIO)) {
    const data = await chamarFuncao<any>("mesa-foto", { acao: "enviar", client_id: clientId, imagem_ids: lote, destino });
    listaDeTextos(data && data.file_ids).forEach((id) => ids.push(id));
    const aviso = texto(data && data.aviso).trim();
    if (aviso) avisos.push(aviso);
  }
  return { file_ids: ids, aviso: avisos.join(" ") };
}

/** URLs assinadas da ação baixar, em qualquer das formas (lista ou mapa id para url). */
export function normalizarUrls(data: any): Record<string, string> {
  const saida: Record<string, string> = {};
  const d = data && typeof data === "object" ? data : {};
  const lista = Array.isArray(d.arquivos) ? d.arquivos : Array.isArray(d.urls) ? d.urls : Array.isArray(d.imagens) ? d.imagens : null;
  if (lista) {
    for (const item of lista) {
      if (item && typeof item === "object") {
        const id = texto(item.imagem_id || item.id);
        const url = texto(item.url || item.signed_url || item.signedUrl);
        if (id && url) saida[id] = url;
      }
    }
  } else if (d.urls && typeof d.urls === "object") {
    Object.keys(d.urls).forEach((k) => {
      const url = texto(d.urls[k]);
      if (url) saida[k] = url;
    });
  }
  return saida;
}

// ------------------------------------------------------------------ upload

export const MAX_BYTES_ORIGINAL = 25 * 1024 * 1024;
export const LOTE_DO_REGISTRO = 20;
const SUBIDAS_AO_MESMO_TEMPO = 3;

const TIPOS_DE_ORIGINAL: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp" };
const EXTENSOES_DE_ORIGINAL: Record<string, string> = { jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp" };
const CONTEUDO_DA_EXTENSAO: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export function extensaoDoOriginal(arquivo: { type?: string; name?: string }): string | null {
  const tem = Object.prototype.hasOwnProperty;
  const tipo = String(arquivo.type || "").toLowerCase();
  if (tem.call(TIPOS_DE_ORIGINAL, tipo)) return TIPOS_DE_ORIGINAL[tipo];
  const ext = extensao(String(arquivo.name || ""));
  return tem.call(EXTENSOES_DE_ORIGINAL, ext) ? EXTENSOES_DE_ORIGINAL[ext] : null;
}

export const caminhoDoOriginal = (clientId: string, id: string, ext: string) => `${clientId}/foto/originais/${id}.${ext}`;

export interface ResultadoDoEnvio {
  registradas: FotoDoAcervo[];
  duplicadas: number;
  recusadas: { nome: string; motivo: string }[];
}

/**
 * Sobe um lote grande de originais (três de cada vez) e registra no acervo
 * em lotes de 20. O arquivo original nunca é alterado: vai como veio.
 */
export async function subirOriginais(
  clientId: string,
  arquivos: File[],
  aoAvancar: (feitos: number, total: number) => void,
): Promise<ResultadoDoEnvio> {
  const recusadas: { nome: string; motivo: string }[] = [];
  const validos: { arquivo: File; ext: string }[] = [];
  for (const a of arquivos) {
    const ext = extensaoDoOriginal(a);
    if (!ext) recusadas.push({ nome: a.name || "imagem", motivo: "formato não aceito (use JPG, PNG ou WEBP)" });
    else if (a.size > MAX_BYTES_ORIGINAL) recusadas.push({ nome: a.name || "imagem", motivo: "acima de 25 MB" });
    else validos.push({ arquivo: a, ext });
  }
  const subidos: { caminho: string; nome: string }[] = [];
  let feitos = 0;
  aoAvancar(0, validos.length);
  let proximo = 0;
  const trabalhar = async () => {
    while (proximo < validos.length) {
      const item = validos[proximo++];
      const caminho = caminhoDoOriginal(clientId, novoId(), item.ext);
      try {
        const { error } = await supabase.storage
          .from("mesa")
          .upload(caminho, item.arquivo, { contentType: CONTEUDO_DA_EXTENSAO[item.ext] || "image/jpeg", upsert: false });
        if (error) throw error;
        subidos.push({ caminho, nome: item.arquivo.name || caminho.split("/").pop() || "foto" });
      } catch (e: any) {
        recusadas.push({ nome: item.arquivo.name || "imagem", motivo: (e && e.message) || "não subiu" });
      }
      feitos++;
      aoAvancar(feitos, validos.length);
    }
  };
  const trabalhadores: Promise<void>[] = [];
  for (let i = 0; i < Math.min(SUBIDAS_AO_MESMO_TEMPO, validos.length); i++) trabalhadores.push(trabalhar());
  await Promise.all(trabalhadores);

  const registradas: FotoDoAcervo[] = [];
  let duplicadas = 0;
  for (let i = 0; i < subidos.length; i += LOTE_DO_REGISTRO) {
    const lote = subidos.slice(i, i + LOTE_DO_REGISTRO);
    const r = await registrarNoAcervo(
      clientId,
      lote.map((s) => s.caminho),
      lote.map((s) => s.nome),
    );
    r.imagens.forEach((f) => registradas.push(f));
    r.recusadas.forEach((x) => recusadas.push(x));
    duplicadas += r.duplicadas;
  }
  return { registradas, duplicadas, recusadas };
}

// ------------------------------------------------------------------ ZIP

const semAcentoNoNome = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();

/**
 * Nome do arquivo dentro do ZIP: sem acento, único, e foto sintética sempre
 * com "gerada" no nome (quem abre o ZIP fora do painel também sabe).
 */
export function nomeNoZip(foto: Pick<FotoDoAcervo, "nome" | "storage_path" | "gerada" | "modo" | "derivada_de">, usados: string[]): string {
  const ext = extensao(foto.storage_path) || extensao(foto.nome) || "jpg";
  let base = foto.nome;
  const i = base.lastIndexOf(".");
  if (i > 0) base = base.slice(0, i);
  base = semAcentoNoNome(base).slice(0, 60) || "foto";
  const classe = classeDaFoto(foto);
  if (classe === "gerada") base += "_gerada";
  else if (classe === "derivada") base += "_tratada";
  let nome = `${base}.${ext}`;
  let n = 2;
  while (usados.indexOf(nome) >= 0) {
    nome = `${base}-${n}.${ext}`;
    n++;
  }
  usados.push(nome);
  return nome;
}

export function leiaMeDoZip(fotos: FotoDoAcervo[], nomes: string[], cliente: string): string {
  const linhas = [
    `Fotos de ${cliente || "cliente"} (Mesa Foto, Aceleriq)`,
    "",
    "Legenda:",
    "  _gerada: imagem sintética criada por IA. Pode conter partes que não existem nas fotos originais.",
    "  _tratada: derivada de uma foto original (fundo, luz, cor ou limpeza).",
    "  sem marca: foto original, como o cliente enviou.",
    "",
  ];
  fotos.forEach((f, i) => {
    const classe = classeDaFoto(f);
    linhas.push(`${nomes[i]}: ${classe === "gerada" ? "GERADA" : classe === "derivada" ? "tratada" : "original"}${f.aprovada ? ", aprovada" : ""}${f.modo ? `, modo ${rotuloDoModo(f.modo)}` : ""}`);
  });
  return linhas.join("\n");
}

function salvarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** URLs das fotos: a ação baixar; sem ela, assina direto no Storage (RLS da equipe). */
async function urlsDasFotos(clientId: string, fotos: FotoDoAcervo[]): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  try {
    for (const lote of emLotes(fotos, LOTE_DO_BAIXAR)) {
      const doLote = normalizarUrls(await chamarFuncao<any>("mesa-foto", { acao: "baixar", client_id: clientId, imagem_ids: lote.map((f) => f.id) }));
      Object.keys(doLote).forEach((k) => {
        urls[k] = doLote[k];
      });
    }
  } catch (e) {
    if (!(e instanceof ErroDaMesa) || (e.codigo !== "servico_indisponivel" && e.codigo !== "acao_desconhecida")) throw e;
  }
  for (const f of fotos) {
    if (urls[f.id]) continue;
    const { data, error } = await supabase.storage.from(f.storage_bucket || "mesa").createSignedUrl(f.storage_path, 900);
    if (!error && data && data.signedUrl) urls[f.id] = data.signedUrl;
  }
  return urls;
}

/** Baixa as fotos num ZIP montado no navegador (jszip só carrega aqui). */
export async function baixarZip(clientId: string, cliente: string, fotos: FotoDoAcervo[], aoAvancar?: (feitos: number, total: number) => void): Promise<number> {
  if (!fotos.length) return 0;
  const urls = await urlsDasFotos(clientId, fotos);
  const modulo: any = await import("jszip");
  const JSZip = modulo.default || modulo;
  const zip = new JSZip();
  const usados: string[] = [];
  const incluidas: FotoDoAcervo[] = [];
  const nomes: string[] = [];
  let feitos = 0;
  for (const f of fotos) {
    const url = urls[f.id];
    if (url) {
      const resposta = await fetch(url);
      if (resposta.ok) {
        const nome = nomeNoZip(f, usados);
        zip.file(nome, await resposta.blob());
        incluidas.push(f);
        nomes.push(nome);
      }
    }
    feitos++;
    if (aoAvancar) aoAvancar(feitos, fotos.length);
  }
  if (!incluidas.length) throw new Error("Nenhuma foto pôde ser baixada agora.");
  zip.file("LEIA-ME.txt", leiaMeDoZip(incluidas, nomes, cliente));
  const blob = await zip.generateAsync({ type: "blob" });
  const hoje = new Date();
  const data = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  salvarBlob(blob, `fotos-${semAcentoNoNome(cliente || "cliente") || "cliente"}-${data}.zip`);
  return incluidas.length;
}

// ------------------------------------------------------------------ estimativas

/**
 * Tamanhos típicos de cada ação da Mesa Foto, para a estimativa antes de
 * gastar. São aproximações declaradas como tais; o custo real vem da resposta.
 */
export const TAMANHOS_DA_FOTO = {
  lerFoto: { entrada: 1800, saida: 700 },
  sugerirKitPorFoto: { entrada: 1500, saida: 500 },
  planejar: { entrada: 25000, saida: 6000 },
  gerarEntrada: 6000,
  conferir: { entrada: 5000, saida: 900 },
  prepararEntrada: 3000,
};

export function partesDaLeitura(catalogo: ModeloIa[], vezes = 1): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "leitura");
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS_DA_FOTO.lerFoto.entrada, tokensSaida: TAMANHOS_DA_FOTO.lerFoto.saida, vezes }];
}

export function partesDaSugestao(catalogo: ModeloIa[], fotos: number): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "leitura");
  const n = Math.max(1, fotos);
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS_DA_FOTO.sugerirKitPorFoto.entrada * n, tokensSaida: TAMANHOS_DA_FOTO.sugerirKitPorFoto.saida * n }];
}

export function partesDoPlanejamento(catalogo: ModeloIa[]): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "diretor_arte");
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS_DA_FOTO.planejar.entrada, tokensSaida: TAMANHOS_DA_FOTO.planejar.saida }];
}

export function partesDaGeracao(modeloImagemId: string | null | undefined, qualidade: Qualidade, vezes = 1): ParteDaEstimativa[] {
  return [{ modeloId: modeloImagemId, tipo: "imagem", imagens: 1, qualidade, tokensEntrada: TAMANHOS_DA_FOTO.gerarEntrada, vezes }];
}

export function partesDoPreparo(modeloImagemId: string | null | undefined, qualidade: Qualidade): ParteDaEstimativa[] {
  return [{ modeloId: modeloImagemId, tipo: "imagem", imagens: 1, qualidade, tokensEntrada: TAMANHOS_DA_FOTO.prepararEntrada }];
}

export function partesDaConferencia(catalogo: ModeloIa[]): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "leitura");
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS_DA_FOTO.conferir.entrada, tokensSaida: TAMANHOS_DA_FOTO.conferir.saida }];
}

// ------------------------------------------------------------------ utilidades do ensaio

/** Tomadas que ainda podem gerar (não bloqueadas, não gerando agora, sem versão aprovada). */
export const tomadasParaGerar = (e: Ensaio | null | undefined) =>
  (e ? e.tomadas : []).filter((t) => t.status !== "bloqueada" && t.status !== "gerando" && !t.versoes.some((v) => v.aprovada));

export function resumoDoEnsaio(e: Ensaio | null | undefined) {
  const tomadas = e ? e.tomadas : [];
  let aprovadas = 0;
  let bloqueadas = 0;
  let paraRevisar = 0;
  let versoes = 0;
  let custo = 0;
  for (const t of tomadas) {
    if (t.status === "bloqueada") bloqueadas++;
    if (t.versoes.some((v) => v.aprovada)) aprovadas++;
    else if (t.versoes.some((v) => !v.rejeitada)) paraRevisar++;
    versoes += t.versoes.length;
    for (const v of t.versoes) custo += v.custo_usd || 0;
  }
  return { total: tomadas.length, aprovadas, bloqueadas, paraRevisar, versoes, custoDasVersoes: custo, custo: e ? Math.max(e.custo_usd, custo) : 0 };
}

/** Kit vazio (sem fotos ligadas). */
export const kitVazio = (clientId: string, tipo: TipoDoKit = "produto"): KitDeFoto => ({
  id: null,
  client_id: clientId,
  tipo,
  nome: "",
  variante: "",
  atributos: { observado: [], informado: [], inferido: [] },
  invariantes: [],
  lacunas: [],
  autorizacao: null,
  frente_imagem_id: null,
  status: "rascunho",
  atualizado_em: null,
  refs: [],
});

// ------------------------------------------------------------------ biblioteca

export type TipoDaBiblioteca = "prompt" | "referencia";

export interface ItemDaBiblioteca {
  id: string;
  client_id: string | null;
  tipo: TipoDaBiblioteca;
  categoria: string;
  titulo: string;
  prompt_pt: string;
  prompt_en: string;
  /** Quando usar este prompt ou referência. */
  uso: string;
  negativo: string;
  imagem_url: string | null;
  /** Miniatura da imagem de exemplo (prompt) ou da referência. */
  miniatura_url: string | null;
  storage_path: string | null;
  /** A imagem de exemplo do prompt foi gerada por IA (biblioteca_exemplo_gerar), não veio de banco público. */
  exemplo_gerado: boolean;
  fonte_nome: string;
  fonte_url: string;
  licenca: string;
  autor: string;
  autor_url: string;
  tags: string[];
  destaque: boolean;
}

/** Imagem achada na busca pública (Openverse), antes de importar. */
export interface ReferenciaEncontrada {
  chave: string;
  titulo: string;
  imagem_url: string;
  miniatura_url: string;
  fonte_nome: string;
  fonte_url: string;
  /** Rótulo da licença como a função mandou (ex.: "CC BY 4.0", "Domínio público"). */
  licenca: string;
  /** Código cru da licença (cc0, by, by-sa, pdm...), só para gravar ao importar. */
  licenca_codigo: string;
  licenca_url: string;
  autor: string;
  autor_url: string;
}

export const CATEGORIAS_DA_BIBLIOTECA: { valor: string; rotulo: string }[] = [
  { valor: "produto", rotulo: "Produto" },
  { valor: "alimento", rotulo: "Alimento" },
  { valor: "bebida", rotulo: "Bebida" },
  { valor: "cosmetico", rotulo: "Cosmético" },
  { valor: "moda", rotulo: "Moda" },
  { valor: "tecnologia", rotulo: "Tecnologia" },
  { valor: "pessoa", rotulo: "Pessoa" },
  { valor: "ambiente", rotulo: "Ambiente" },
  { valor: "estilo", rotulo: "Estilo" },
  { valor: "composicao", rotulo: "Composição" },
  { valor: "luz", rotulo: "Luz" },
  { valor: "cenario", rotulo: "Cenário" },
];

export const rotuloDaCategoriaDaBiblioteca = (c?: string | null) =>
  (CATEGORIAS_DA_BIBLIOTECA.find((x) => x.valor === c) || { rotulo: c ? String(c) : "Outra" }).rotulo;

export function normalizarItemDaBiblioteca(v: any): ItemDaBiblioteca | null {
  if (!v || typeof v !== "object" || !v.id) return null;
  const tipo: TipoDaBiblioteca = texto(v.tipo) === "referencia" ? "referencia" : "prompt";
  return {
    id: String(v.id),
    client_id: textoOuNulo(v.client_id),
    tipo,
    categoria: texto(v.categoria) || "estilo",
    titulo: texto(v.titulo) || (tipo === "prompt" ? "Prompt sem título" : "Referência sem título"),
    prompt_pt: texto(v.prompt_pt),
    prompt_en: texto(v.prompt_en),
    uso: texto(v.uso),
    negativo: texto(v.negativo),
    imagem_url: textoOuNulo(v.imagem_url || (v.exemplo && v.exemplo.imagem_url)),
    miniatura_url: textoOuNulo(v.miniatura_url || v.thumbnail_url || (v.exemplo && v.exemplo.miniatura_url)),
    storage_path: textoOuNulo(v.storage_path || (v.exemplo && v.exemplo.storage_path)),
    exemplo_gerado:
      booleano(v.exemplo_gerado) || (!!v.exemplo && typeof v.exemplo === "object" && booleano(v.exemplo.gerado)) || listaDeTextos(v.tags).indexOf("exemplo_gerado") >= 0,
    fonte_nome: texto(v.fonte_nome),
    fonte_url: texto(v.fonte_url),
    licenca: texto(v.licenca),
    autor: texto(v.autor),
    autor_url: texto(v.autor_url),
    tags: listaDeTextos(v.tags),
    destaque: booleano(v.destaque),
  };
}

export function normalizarEncontrada(v: any, i: number): ReferenciaEncontrada | null {
  if (!v || typeof v !== "object") return null;
  const imagem = texto(v.imagem_url || v.url || v.image_url);
  if (!imagem) return null;
  const codigo = texto(v.licenca || v.license);
  return {
    chave: texto(v.id || v.chave) || `achada-${i}`,
    titulo: texto(v.titulo || v.title) || "Sem título",
    imagem_url: imagem,
    miniatura_url: texto(v.miniatura_url || v.thumbnail) || imagem,
    fonte_nome: texto(v.fonte_nome || v.source || v.provider) || "Openverse",
    fonte_url: texto(v.fonte_url || v.foreign_landing_url || v.pagina_url),
    // O rótulo vem pronto da função: mostra como veio, sem formatar de novo.
    licenca: texto(v.licenca_rotulo) || codigo,
    licenca_codigo: codigo,
    licenca_url: texto(v.licenca_url || v.license_url),
    autor: texto(v.autor || v.creator),
    autor_url: texto(v.autor_url || v.creator_url),
  };
}

export const chaveDaBiblioteca = (clientId: string) => ["mesa-foto", "biblioteca", clientId];

/** Biblioteca da agência (client_id nulo) e a deste cliente. */
export function useBiblioteca(clientId: string, ativo = true) {
  return useQuery({
    queryKey: chaveDaBiblioteca(clientId),
    enabled: ativo && !!clientId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<ItemDaBiblioteca[]> => {
      const { data, error } = await (supabase as any)
        .from("foto_biblioteca")
        .select("*")
        .or(`client_id.is.null,client_id.eq.${clientId}`)
        .order("destaque", { ascending: false })
        .order("titulo", { ascending: true })
        .limit(1000);
      if (error) throw erroDeTabela(error, "foto_biblioteca");
      const saida: ItemDaBiblioteca[] = [];
      for (const b of (data || []) as any[]) {
        const n = normalizarItemDaBiblioteca(b);
        if (n) saida.push(n);
      }
      return saida;
    },
  });
}

export async function buscarReferencias(q: string): Promise<ReferenciaEncontrada[]> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "referencias_buscar", q: q.trim() });
  const d = data && typeof data === "object" ? data : {};
  const lista = Array.isArray(d.resultados) ? d.resultados : Array.isArray(d.referencias) ? d.referencias : Array.isArray(d.itens) ? d.itens : [];
  const saida: ReferenciaEncontrada[] = [];
  lista.forEach((b: any, i: number) => {
    const n = normalizarEncontrada(b, i);
    if (n) saida.push(n);
  });
  return saida;
}

export async function importarReferencia(clientId: string, r: ReferenciaEncontrada, categoria: string): Promise<ItemDaBiblioteca | null> {
  const data = await chamarFuncao<any>("mesa-foto", {
    acao: "referencia_importar",
    client_id: clientId,
    categoria,
    referencia: {
      id: r.chave,
      titulo: r.titulo,
      imagem_url: r.imagem_url,
      fonte_nome: r.fonte_nome,
      miniatura_url: r.miniatura_url,
      fonte_url: r.fonte_url,
      licenca: r.licenca_codigo || r.licenca,
      licenca_rotulo: r.licenca,
      licenca_url: r.licenca_url,
      autor: r.autor,
      autor_url: r.autor_url,
    },
  });
  return normalizarItemDaBiblioteca(data && (data.item || data.referencia));
}

/**
 * "Salvar como meu": cópia do item da agência na biblioteca do cliente. Com
 * origem_id a função copia o item como está no banco (os outros campos seriam
 * ignorados), então só o id vai.
 */
export async function salvarNaBiblioteca(clientId: string, item: ItemDaBiblioteca): Promise<ItemDaBiblioteca | null> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "biblioteca_salvar", client_id: clientId, item: { origem_id: item.id } });
  return normalizarItemDaBiblioteca(data && data.item);
}

// ------------------------------------------------------------------ guia

export type ModoDoGuia = "biblioteca" | "referencia" | "livre" | "nenhum";

export interface Guia {
  modo: ModoDoGuia;
  prompt_id?: string;
  referencia_ids?: string[];
  texto?: string;
}

export const MODOS_DO_GUIA: { valor: ModoDoGuia; rotulo: string; dica: string }[] = [
  { valor: "biblioteca", rotulo: "Prompt da biblioteca", dica: "Um prompt pronto de estilo, luz, composição ou cenário." },
  { valor: "referencia", rotulo: "Referência de imagem", dica: "Até 2 imagens da biblioteca guiam o clima. Nunca o assunto." },
  { valor: "livre", rotulo: "Escrever meu prompt", dica: "Você descreve a direção com as suas palavras." },
  { valor: "nenhum", rotulo: "Sem guia", dica: "Só o kit, a receita e o contexto do cliente guiam." },
];

/** A função usa no máximo 2 referências de estilo (MAX_REFERENCIAS_DE_ESTILO) e 1500 letras de texto livre. */
export const MAX_REFERENCIAS_NO_GUIA = 2;
export const MAX_TEXTO_DO_GUIA = 1500;

/** Guia pronto para mandar: só os campos do modo escolhido; incompleto vira "nenhum". */
export function guiaParaEnviar(g: Guia | null | undefined): Guia {
  if (!g) return { modo: "nenhum" };
  if (g.modo === "biblioteca") return g.prompt_id ? { modo: "biblioteca", prompt_id: g.prompt_id } : { modo: "nenhum" };
  if (g.modo === "referencia") {
    const ids = (g.referencia_ids || []).filter(Boolean).slice(0, MAX_REFERENCIAS_NO_GUIA);
    return ids.length ? { modo: "referencia", referencia_ids: ids } : { modo: "nenhum" };
  }
  if (g.modo === "livre") {
    const t = (g.texto || "").trim();
    return t ? { modo: "livre", texto: t.slice(0, MAX_TEXTO_DO_GUIA) } : { modo: "nenhum" };
  }
  return { modo: "nenhum" };
}

/** Frase do que será usado, sempre à vista antes de gerar. */
export function descreverGuia(g: Guia | null | undefined, biblioteca: ItemDaBiblioteca[]): string {
  const pronto = guiaParaEnviar(g);
  if (pronto.modo === "biblioteca") {
    const p = biblioteca.find((i) => i.id === pronto.prompt_id);
    return p ? `Prompt da biblioteca: ${p.titulo}` : "Prompt da biblioteca escolhido";
  }
  if (pronto.modo === "referencia") {
    const nomes = (pronto.referencia_ids || []).map((id) => {
      const r = biblioteca.find((i) => i.id === id);
      return r ? r.titulo : "referência";
    });
    return `Referência de imagem: ${nomes.join(", ")}`;
  }
  if (pronto.modo === "livre") {
    const t = pronto.texto || "";
    return `Seu prompt: ${t.slice(0, 140)}${t.length > 140 ? "..." : ""}`;
  }
  return "Sem guia: só o kit, a receita e o contexto do cliente";
}

// ------------------------------------------------------------------ agente

export interface SugestaoDoAgente {
  chave: string;
  tipo: string;
  titulo: string;
  descricao: string;
  bruto: Record<string, unknown>;
}

export interface MensagemDoDiretor {
  id: string;
  papel: "usuario" | "agente";
  texto: string;
  sugestoes: SugestaoDoAgente[];
  custo_usd: number | null;
  anexos: number;
  /** Quantos anexos foram como referência de estilo (prints, moodboard). */
  estilos?: number;
  entendi?: string;
  proximo_passo?: string;
  kit_ids?: string[];
  identificacao?: IdentificacaoDoProduto | null;
}

export function normalizarSugestoes(v: unknown): SugestaoDoAgente[] {
  const saida: SugestaoDoAgente[] = [];
  if (!Array.isArray(v)) return saida;
  v.forEach((b: any, i: number) => {
    if (typeof b === "string" && b.trim()) {
      saida.push({ chave: `s-${i}`, tipo: "nota", titulo: b.trim(), descricao: "", bruto: { texto: b.trim() } });
      return;
    }
    if (!b || typeof b !== "object") return;
    const titulo = texto(b.titulo || b.nome || b.resumo || b.texto) || tituloPadraoDaSugestao(texto(b.tipo), b);
    if (!titulo) return;
    // A função manda o porquê em "motivo" (e o termo da busca em "busca").
    const descricao = texto(b.motivo || b.descricao || b.detalhe || b.porque) || (b.busca ? `Buscar: ${texto(b.busca)}` : "");
    saida.push({ chave: texto(b.id) || `s-${i}`, tipo: texto(b.tipo) || "ajuste", titulo, descricao, bruto: b });
  });
  return saida;
}

/** A função lê até 4 fotos anexadas por mensagem ao diretor. */
export const MAX_ANEXOS_DO_DIRETOR = 4;

export interface RespostaDoDiretor {
  resposta: string;
  /** O que o diretor entendeu do pedido (ex.: "vi caixas do mouse NTC X, vou trabalhar com ele"). */
  entendi: string;
  /** O próximo passo concreto que ele propõe. */
  proximo_passo: string;
  sugestoes: SugestaoDoAgente[];
  conversa_id: string | null;
  custo_usd: number | null;
  /** Kits que a conversa gravou (rascunho): entram na lista e na barra. */
  kit_ids: string[];
  /** Quando o diretor já rodou produto_identificar na conversa. */
  identificacao: IdentificacaoDoProduto | null;
}

export async function conversarComDiretor(p: {
  clientId: string;
  mensagem: string;
  conversaId: string | null;
  kitId: string | null;
  ensaioId: string | null;
  anexos: string[];
  /** Prints de perfil ou moodboard: vão como referência de estilo, nunca como o assunto. */
  anexosDeEstilo?: string[];
  /** Depois de "Nova conversa": a função abre uma conversa nova em vez de continuar a do kit. */
  novaConversa?: boolean;
  /** A campanha da Mesa escolhida em Variações ou Campanha (id ou "nenhuma"); sem ela, a do mês. */
  campanhaId?: string | null;
}): Promise<RespostaDoDiretor> {
  const corpo: Record<string, unknown> = { acao: "agente_conversar", client_id: p.clientId, mensagem: p.mensagem.trim() };
  if (p.campanhaId) corpo.campanha_id = p.campanhaId;
  if (p.conversaId) corpo.conversa_id = p.conversaId;
  else if (p.novaConversa) corpo.nova_conversa = true;

  if (p.kitId) corpo.kit_id = p.kitId;
  if (p.ensaioId) corpo.ensaio_id = p.ensaioId;
  const anexos: Record<string, string>[] = p.anexos.map((id) => ({ imagem_id: id }));
  (p.anexosDeEstilo || []).forEach((id) => {
    if (!anexos.some((a) => a.imagem_id === id)) anexos.push({ imagem_id: id, papel: "estilo" });
  });
  if (anexos.length) corpo.anexos = anexos.slice(0, MAX_ANEXOS_DO_DIRETOR);
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  const kitIds = listaDeTextos(data && data.kit_ids);
  if (data && data.kit && data.kit.id && kitIds.indexOf(String(data.kit.id)) < 0) kitIds.push(String(data.kit.id));
  const ident = data && (data.identificacao || (data.produto && typeof data.produto === "object" ? data : null));
  return {
    resposta: texto(data && (data.resposta || data.texto)),
    entendi: texto(data && (data.entendi || data.entendimento)),
    proximo_passo: texto(data && data.proximo_passo),
    sugestoes: normalizarSugestoes(data && data.sugestoes),
    conversa_id: textoOuNulo(data && data.conversa_id),
    custo_usd: numeroOuNulo(data && data.custo_usd),
    kit_ids: kitIds,
    identificacao: ident ? normalizarIdentificacao(ident) : null,
  };
}

/** Sugestão que muda tomadas (só com um ensaio aberto); prompt e busca valem sem ensaio. */
export const sugestaoPedeEnsaio = (s: Pick<SugestaoDoAgente, "tipo">) => s.tipo === "tomada_nova" || s.tipo === "ajuste_tomada";

export async function aplicarSugestao(
  p: { clientId: string; ensaioId: string | null; kitId?: string | null },
  sugestao: SugestaoDoAgente,
  /** Ajustes da equipe no cartão (quantidade, tipos, variações escolhidas) por cima da sugestão. */
  ajustes?: Record<string, unknown>,
): Promise<{
  ensaio: Ensaio | null;
  item: ItemDaBiblioteca | null;
  referencias: ReferenciaEncontrada[];
  busca: string;
  estimativa_usd: number | null;
  guia_de_estilo: GuiaDeEstilo | null;
  kit_ids: string[];
  custo_usd?: number;
}> {
  const cria = sugestaoCriaEnsaio(sugestao);
  const corpo: Record<string, unknown> = { acao: "agente_aplicar", client_id: p.clientId, sugestao: ajustes ? { ...sugestao.bruto, ...ajustes } : sugestao.bruto };
  // Plano de variações e campanha criam um ensaio novo (não mexem no aberto).
  if (p.ensaioId && !cria) corpo.ensaio_id = p.ensaioId;
  if (p.kitId && cria) corpo.kit_id = p.kitId;
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  const referencias: ReferenciaEncontrada[] = [];
  if (data && Array.isArray(data.itens)) {
    data.itens.forEach((b: any, i: number) => {
      const n = normalizarEncontrada(b, i);
      if (n) referencias.push(n);
    });
  }
  const kitIds = listaDeTextos(data && data.kit_ids);
  if (data && data.kit && data.kit.id && kitIds.indexOf(String(data.kit.id)) < 0) kitIds.push(String(data.kit.id));
  return {
    ensaio: normalizarEnsaio(data && data.ensaio),
    item: normalizarItemDaBiblioteca(data && data.item),
    referencias,
    busca: texto(data && data.busca),
    estimativa_usd: numeroOuNulo(data && data.estimativa_usd),
    guia_de_estilo: normalizarGuiaDeEstilo(data && data.guia_de_estilo),
    kit_ids: kitIds,
    custo_usd: data && data.custo_usd,
  };
}


export function partesDaConversa(catalogo: ModeloIa[]): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "diretor_arte");
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: 14000, tokensSaida: 1800 }];
}

// ------------------------------------------------------------------ v2: produto pela embalagem

/**
 * produto_identificar (CONTRATO-V2): a visão lê a embalagem ou a foto
 * (marca, modelo, variante, códigos) e a pesquisa na internet acha o produto
 * real. As fotos oficiais baixadas entram no acervo com a tag referencia_web
 * e só servem para fidelidade: nunca vão ao cliente como foto final.
 */
export interface ProdutoIdentificado {
  marca: string;
  modelo: string;
  variante: string;
  categoria: string;
  especificacoes: string[];
  /** Confiança em palavras (alta, média, baixa) ou como a função mandou. */
  confianca: string;
  evidencias: string[];
}

export interface ReferenciaDaWeb {
  imagem_id: string;
  url_origem: string;
  pagina: string;
  fonte: string;
  /** Link assinado da cópia no acervo (vence): só para ver antes do acervo reler. */
  url: string;
}

export interface IdentificacaoDoProduto {
  produto: ProdutoIdentificado | null;
  referencias_web: ReferenciaDaWeb[];
  lacunas: string[];
  proximo_passo: string;
  /** As fotos do cliente que foram lidas. */
  imagem_ids: string[];
  custo_usd: number | null;
  /** O kit rascunho que a função já gravou com as fotos e as referências (salvar_kit, padrão). */
  kit: KitDeFoto | null;
  /** "criado" ou "atualizado" (kit rascunho do mesmo produto é atualizado, não duplicado). */
  kit_acao: string;
  /** Aviso fixo das referências da internet (uso interno, não publicar). */
  aviso_referencias: string;
  /** O que dá para prometer com essas referências. */
  promessa: string;
  /** O Jev viu outro candidato ou ficou em dúvida (só aviso). */
  aviso_jev: string;
  texto_lido: string;
}

/** A função lê até 6 fotos por identificação (fotos_demais acima disso). */
export const MAX_FOTOS_NA_IDENTIFICACAO = 6;

/** Confiança em palavras: alta, média ou baixa (número de 0 a 1 ou de 0 a 100). */
export function rotuloDaConfianca(v: unknown): string {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return "";
  const n = Number(v);
  if (isFinite(n)) {
    const f = n > 1 ? n / 100 : n;
    return f >= 0.75 ? "alta" : f >= 0.45 ? "média" : "baixa";
  }
  return texto(v).trim().toLowerCase();
}

export function normalizarProdutoIdentificado(v: any): ProdutoIdentificado | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const especificacoes: string[] = [];
  const specs = v.especificacoes || v.specs;
  if (Array.isArray(specs)) {
    for (const e of specs) {
      if (typeof e === "string") {
        if (e.trim()) especificacoes.push(e.trim());
      } else if (e && typeof e === "object") {
        const nome = texto(e.nome || e.chave || e.label);
        const valor = texto(e.valor || e.value);
        const t = nome && valor ? `${nome}: ${valor}` : nome || valor;
        if (t) especificacoes.push(t);
      }
    }
  } else if (specs && typeof specs === "object") {
    Object.keys(specs).forEach((k) => {
      const valor = texto(specs[k]);
      if (valor) especificacoes.push(`${k}: ${valor}`);
    });
  } else listaDeTextos(specs).forEach((t) => especificacoes.push(t));
  const p: ProdutoIdentificado = {
    marca: texto(v.marca || v.brand),
    modelo: texto(v.modelo || v.model),
    variante: texto(v.variante || v.variant || v.cor),
    categoria: texto(v.categoria || v.tipo),
    especificacoes,
    confianca: rotuloDaConfianca(v.confianca),
    evidencias: listaDeTextos(v.evidencias),
  };
  return p.marca || p.modelo || p.variante || p.categoria || p.especificacoes.length ? p : null;
}

export function normalizarReferenciaDaWeb(v: any): ReferenciaDaWeb | null {
  if (!v || typeof v !== "object") return null;
  const id = texto(v.imagem_id || v.id);
  if (!id) return null;
  const pagina = texto(v.pagina || v.pagina_url);
  let fonte = texto(v.fonte || v.site);
  if (!fonte && pagina) {
    const m = pagina.match(/^https?:\/\/([^/]+)/i);
    fonte = m ? m[1].replace(/^www\./i, "") : "";
  }
  // "url" é o link assinado da cópia no acervo (para ver); "url_origem" é de onde veio.
  return { imagem_id: id, url_origem: texto(v.url_origem || v.imagem_url), pagina, fonte, url: texto(v.url) };
}

export function normalizarIdentificacao(data: any, imagemIds: string[] = []): IdentificacaoDoProduto {
  const d = data && typeof data === "object" ? data : {};
  const refs: ReferenciaDaWeb[] = [];
  const brutas = Array.isArray(d.referencias_web) ? d.referencias_web : Array.isArray(d.referencias) ? d.referencias : [];
  for (const b of brutas) {
    const r = normalizarReferenciaDaWeb(b);
    if (r && !refs.some((x) => x.imagem_id === r.imagem_id)) refs.push(r);
  }
  const lidas = listaDeTextos(d.imagem_ids);
  const jev = d.aviso_jev;
  const kit = d.kit && typeof d.kit === "object" ? normalizarKit(d.kit, Array.isArray(d.kit.refs) ? d.kit.refs : []) : null;
  return {
    produto: normalizarProdutoIdentificado(d.produto),
    referencias_web: refs,
    lacunas: listaDeTextos(d.lacunas),
    proximo_passo: texto(d.proximo_passo),
    imagem_ids: lidas.length ? lidas : imagemIds.slice(),
    custo_usd: numeroOuNulo(d.custo_usd),
    kit: kit && kit.id ? kit : null,
    kit_acao: texto(d.kit_acao),
    aviso_referencias: texto(d.aviso_referencias),
    promessa: texto(d.promessa),
    aviso_jev: typeof jev === "string" ? jev : jev && typeof jev === "object" ? texto(jev.aviso) : "",
    texto_lido: texto(d.texto_lido || (d.produto && d.produto.texto_lido)),
  };
}

export async function identificarProduto(clientId: string, imagemIds: string[]): Promise<IdentificacaoDoProduto> {
  const ids = imagemIds.slice(0, MAX_FOTOS_NA_IDENTIFICACAO);
  const data = await chamarFuncao<any>("mesa-foto", { acao: "produto_identificar", client_id: clientId, imagem_ids: ids });
  return normalizarIdentificacao(data, ids);
}

/** Nome curto do produto lido: "NTC Mouse X, grafite". */
export function nomeDoProduto(p: ProdutoIdentificado | null | undefined): string {
  if (!p) return "";
  const base = [p.marca, p.modelo].filter(Boolean).join(" ");
  return p.variante ? `${base || p.categoria || "Produto"}, ${p.variante}` : base || p.categoria;
}

/**
 * Põe as referências da internet no kit (papel identidade, com a fonte),
 * sem IA. Não duplica a mesma imagem no mesmo papel.
 */
export function kitComReferenciasWeb(kit: KitDeFoto, refs: ReferenciaDaWeb[]): KitDeFoto {
  const novas = kit.refs.slice();
  refs.forEach((r) => {
    if (novas.some((x) => x.imagem_id === r.imagem_id && x.papel === "identidade")) return;
    novas.push({ imagem_id: r.imagem_id, papel: "identidade", vista: "", prioridade: novas.length, origem_web: { url: r.url_origem, fonte: r.fonte, pagina: r.pagina } });
  });
  return { ...kit, refs: novas };
}

export function partesDaIdentificacao(catalogo: ModeloIa[], fotos: number): ParteDaEstimativa[] {
  const leitor = padraoPara(catalogo, "leitura");
  const pesquisa = padraoPara(catalogo, "estrategista") || leitor;
  const n = Math.max(1, Math.min(MAX_FOTOS_NA_IDENTIFICACAO, fotos));
  return [
    { modeloId: leitor ? leitor.id : null, tipo: "texto", tokensEntrada: TAMANHOS_DA_FOTO.lerFoto.entrada * n, tokensSaida: 900 },
    // Pesquisa na internet: páginas e imagens do produto entram como texto.
    { modeloId: pesquisa ? pesquisa.id : null, tipo: "texto", tokensEntrada: 30000, tokensSaida: 3000 },
  ];
}

// ------------------------------------------------------------------ v2: variações e campanha

/** Uma chamada de geração por foto: o lote vai de 1 a 16. */
export const QUANTIDADE_MAXIMA_DO_LOTE = 16;
export const limitarQuantidade = (n: unknown) => {
  const v = Math.round(Number(n));
  return isFinite(v) ? Math.max(1, Math.min(QUANTIDADE_MAXIMA_DO_LOTE, v)) : 1;
};

export const TIPOS_DE_VARIACAO: { valor: string; rotulo: string }[] = [
  { valor: "heroi_fundo_cor", rotulo: "Herói em fundo de cor" },
  { valor: "fundo_branco", rotulo: "Fundo branco" },
  { valor: "lifestyle", rotulo: "Lifestyle na mesa" },
  { valor: "na_mao", rotulo: "Na mão" },
  { valor: "flat_lay", rotulo: "Flat lay com props" },
  { valor: "macro", rotulo: "Macro de detalhe" },
  { valor: "cenario_marca", rotulo: "Cenário da marca" },
  { valor: "flutuando", rotulo: "Produto flutuando" },
  { valor: "fora_da_caixa", rotulo: "Fora da caixa" },
  { valor: "com_embalagem", rotulo: "Com a embalagem" },
];

export const rotuloDoTipoDeVariacao = (t?: string | null) => {
  const achado = TIPOS_DE_VARIACAO.find((x) => x.valor === t);
  return achado ? achado.rotulo : t ? String(t).replace(/_/g, " ") : "";
};

/** Receitas que têm tela própria (não aparecem na grade de receitas do Ensaio). */
export const RECEITA_DA_CAMPANHA = "campanha-com-modelo";
export const RECEITAS_COM_TELA_PROPRIA = [RECEITA_DA_CAMPANHA];

const NOMES_EXTRAS_DE_RECEITA: Record<string, string> = {
  "campanha-com-modelo": "Campanha com modelo",
  "fora-da-embalagem": "Fora da embalagem",
  variacoes: "Variações do produto",
  "variacoes-do-produto": "Variações do produto",
};

/** Nome do ensaio para a tela: receita da função, nome conhecido ou o id. */
export function nomeDaReceita(receitas: Receita[] | null | undefined, id: string): string {
  const r = (receitas || []).find((x) => x.id === id);
  if (r) return r.nome;
  return NOMES_EXTRAS_DE_RECEITA[id] || id || "Ensaio";
}

export const ehCampanha = (e: Pick<Ensaio, "receita_id"> | null | undefined) => !!e && e.receita_id === RECEITA_DA_CAMPANHA;

export async function planejarVariacoes(p: {
  clientId: string;
  kitId: string;
  quantidade: number;
  tipos: string[];
  pedido: string;
  referenciaIds?: string[];
  /** Campanha da Mesa (mesa_campanhas) que orienta o plano; sem ela, a função usa a do mês. */
  campanhaId?: string | null;
}): Promise<{ ensaio: Ensaio | null; estimativa_usd: number | null; lacunas: string[]; custo_usd?: number }> {
  const corpo: Record<string, unknown> = { acao: "variacoes_planejar", client_id: p.clientId, kit_id: p.kitId, quantidade: limitarQuantidade(p.quantidade) };
  if (p.campanhaId) corpo.campanha_id = p.campanhaId;
  if (p.tipos.length) corpo.tipos = p.tipos;
  if (p.pedido.trim()) corpo.pedido = p.pedido.trim();
  if (p.referenciaIds && p.referenciaIds.length) corpo.referencia_ids = p.referenciaIds;
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  return { ensaio: normalizarEnsaio(data && data.ensaio), estimativa_usd: numeroOuNulo(data && data.estimativa_usd), lacunas: listaDeTextos(data && data.lacunas), custo_usd: data && data.custo_usd };
}

/** A campanha lê até 6 referências de estilo (print de perfil, moodboard). */
export const MAX_REFERENCIAS_DA_CAMPANHA = 6;

export async function planejarCampanha(p: {
  clientId: string;
  kitId: string;
  quantidade: number;
  referenciasEstiloIds: string[];
  modelo: PerfilDoModelo;
  pedido: string;
  /** Campanha da Mesa (mesa_campanhas) que orienta o plano; sem ela, a função usa a do mês. */
  campanhaId?: string | null;
}): Promise<{ ensaio: Ensaio | null; guia_de_estilo: GuiaDeEstilo | null; estimativa_usd: number | null; lacunas: string[]; promessa: string; custo_usd?: number }> {
  const corpo: Record<string, unknown> = { acao: "campanha_planejar", client_id: p.clientId, kit_id: p.kitId, quantidade: limitarQuantidade(p.quantidade) };
  if (p.campanhaId) corpo.campanha_id = p.campanhaId;
  const refs = p.referenciasEstiloIds.filter(Boolean).slice(0, MAX_REFERENCIAS_DA_CAMPANHA);
  if (refs.length) corpo.referencias_estilo_ids = refs;
  const modelo: Record<string, string> = {};
  if (p.modelo.perfil.trim()) modelo.perfil = p.modelo.perfil.trim();
  if (p.modelo.idade_aprox.trim()) modelo.idade_aprox = p.modelo.idade_aprox.trim();
  if (p.modelo.estilo.trim()) modelo.estilo = p.modelo.estilo.trim();
  if (Object.keys(modelo).length) corpo.modelo = modelo;
  if (p.pedido.trim()) corpo.pedido = p.pedido.trim();
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  const ensaio = normalizarEnsaio(data && data.ensaio);
  const guia = normalizarGuiaDeEstilo(data && data.guia_de_estilo) || (ensaio ? ensaio.direcao.guia_de_estilo : null);
  const perfil = normalizarPerfilDoModelo(data && data.modelo) || (ensaio ? ensaio.direcao.modelo : null);
  // O guia e o modelo ficam no ensaio (direcao): a tela mostra de lá quando volta.
  const comGuia = ensaio ? { ...ensaio, direcao: { ...ensaio.direcao, guia_de_estilo: ensaio.direcao.guia_de_estilo || guia, modelo: ensaio.direcao.modelo || perfil } } : ensaio;
  return {
    ensaio: comGuia,
    guia_de_estilo: guia,
    estimativa_usd: numeroOuNulo(data && data.estimativa_usd),
    lacunas: listaDeTextos(data && data.lacunas),
    promessa: texto(data && data.promessa),
    custo_usd: data && data.custo_usd,
  };
}

/** Planejar variações ou campanha: texto do diretor (mais a leitura das referências). */
export function partesDoPlanoDeLote(catalogo: ModeloIa[], referencias = 0): ParteDaEstimativa[] {
  const partes = partesDoPlanejamento(catalogo);
  if (referencias > 0) partes.push(partesDaLeitura(catalogo, referencias)[0]);
  return partes;
}

// ------------------------------------------------------------------ v2: sugestões novas do diretor

export interface VariacaoPlanejada {
  nome: string;
  tipo: string;
  camera: string;
  cenario: string;
  luz: string;
  props: string[];
  formato: string;
  /** Como veio do diretor: volta assim para agente_aplicar (a função confere de novo). */
  bruto: Record<string, unknown>;
}

export interface PlanoDeVariacoes {
  kit_id: string | null;
  quantidade: number;
  variacoes: VariacaoPlanejada[];
}

export interface FotoDaCampanhaPlanejada {
  nome: string;
  cenario: string;
  luz: string;
  enquadramento: string;
  formato: string;
  bruto: Record<string, unknown>;
}

export interface PlanoDeCampanha {
  kit_id: string | null;
  quantidade: number;
  guia_de_estilo: GuiaDeEstilo | null;
  modelo: PerfilDoModelo | null;
  fotos: FotoDaCampanhaPlanejada[];
}

/** Tipos de sugestão que criam um ensaio novo (e um lote para gerar). */
export const TIPOS_QUE_CRIAM_ENSAIO = ["plano_de_variacoes", "campanha"];
export const sugestaoCriaEnsaio = (s: Pick<SugestaoDoAgente, "tipo">) => TIPOS_QUE_CRIAM_ENSAIO.indexOf(s.tipo) >= 0;

/** O plano pode vir no topo da sugestão, em "plano" ou em "campos". */
function corpoDoPlano(b: any): any {
  if (!b || typeof b !== "object") return {};
  if (b.plano && typeof b.plano === "object") return b.plano;
  if (b.campos && typeof b.campos === "object" && !b.variacoes && !b.fotos && !b.imagem_ids) return b.campos;
  return b;
}

/** Câmera em palavras: objeto { azimute, elevacao, enquadramento } ou id de preset ("a45-e30-dmedio"). */
function textoDaCamera(v: any): string {
  if (!v) return "";
  if (typeof v === "string") {
    const m = v.match(/^a(-?\d+)-e(-?\d+)-d([a-z]+)$/);
    if (!m) return v;
    return rotuloDaCamera({ azimute: Number(m[1]), elevacao: Number(m[2]), enquadramento: m[3] === "detalhe" || m[3] === "aberto" ? m[3] : "medio" });
  }
  const c = normalizarCamera(v);
  return c ? rotuloDaCamera(c) : textoDaCamera(texto(v.preset_id || v.nome));
}

export function lerPlanoDeVariacoes(bruto: any): PlanoDeVariacoes {
  const b = corpoDoPlano(bruto);
  const variacoes: VariacaoPlanejada[] = [];
  const lista = Array.isArray(b.variacoes) ? b.variacoes : Array.isArray(b.tomadas) ? b.tomadas : [];
  lista.forEach((v: any, i: number) => {
    if (!v || typeof v !== "object") return;
    const tipo = texto(v.tipo || v.tipo_variacao);
    variacoes.push({
      nome: texto(v.nome || v.titulo) || rotuloDoTipoDeVariacao(tipo) || `Variação ${i + 1}`,
      tipo,
      camera: textoDaCamera(v.camera),
      cenario: texto(v.cenario),
      luz: texto(v.luz),
      props: listaDeTextos(v.props),
      formato: texto(v.formato),
      bruto: v,
    });
  });
  const q = numeroOuNulo(b.quantidade);
  return { kit_id: textoOuNulo(b.kit_id || (bruto && bruto.kit_id)), quantidade: limitarQuantidade(q === null ? variacoes.length || 8 : q), variacoes };
}

export function lerPlanoDeCampanha(bruto: any): PlanoDeCampanha {
  const b = corpoDoPlano(bruto);
  const fotos: FotoDaCampanhaPlanejada[] = [];
  (Array.isArray(b.fotos) ? b.fotos : Array.isArray(b.tomadas) ? b.tomadas : []).forEach((f: any, i: number) => {
    if (typeof f === "string") {
      if (f.trim()) fotos.push({ nome: f.trim(), cenario: "", luz: "", enquadramento: "", formato: "", bruto: { nome: f.trim() } });
      return;
    }
    if (!f || typeof f !== "object") return;
    fotos.push({
      nome: texto(f.nome || f.titulo) || `Foto ${i + 1}`,
      cenario: texto(f.cenario),
      luz: texto(f.luz),
      enquadramento: textoDaCamera(f.enquadramento || f.camera),
      formato: texto(f.formato),
      bruto: f,
    });
  });
  const q = numeroOuNulo(b.quantidade);
  return {
    kit_id: textoOuNulo(b.kit_id || (bruto && bruto.kit_id)),
    quantidade: limitarQuantidade(q === null ? fotos.length || 6 : q),
    guia_de_estilo: normalizarGuiaDeEstilo(b.guia_de_estilo),
    modelo: normalizarPerfilDoModelo(b.modelo),
    fotos,
  };
}

export const lerFotosParaIdentificar = (bruto: any): string[] => {
  const b = corpoDoPlano(bruto);
  return listaDeTextos(b.imagem_ids || (bruto && bruto.imagem_ids));
};

function tituloPadraoDaSugestao(tipo: string, b: any): string {
  if (tipo === "plano_de_variacoes") return `Plano de ${lerPlanoDeVariacoes(b).quantidade} variações`;
  if (tipo === "campanha") return "Campanha com modelo";
  if (tipo === "identificar_produto") return "Identificar o produto";
  return "";
}

// ------------------------------------------------------------------ v2: exemplo da biblioteca

/** Gera a imagem de exemplo de um prompt da biblioteca (paga, uma vez; marcada "exemplo gerado"). */
export async function gerarExemploDaBiblioteca(
  clientId: string,
  itemId: string,
  modeloImagemId?: string | null,
): Promise<{ item: ItemDaBiblioteca | null; custo_usd?: number }> {
  // Mesma qualidade da estimativa na tela (partesDoExemplo): o preço à vista é o que se paga.
  const corpo: Record<string, unknown> = { acao: "biblioteca_exemplo_gerar", client_id: clientId, item_id: itemId, qualidade: QUALIDADE_DO_EXEMPLO };
  if (modeloImagemId) corpo.modelo_imagem_id = modeloImagemId;
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  return { item: normalizarItemDaBiblioteca(data && data.item), custo_usd: data && data.custo_usd };
}

export const QUALIDADE_DO_EXEMPLO: Qualidade = "media";

export function partesDoExemplo(catalogo: ModeloIa[]): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "imagem");
  return partesDaGeracao(m ? m.id : null, QUALIDADE_DO_EXEMPLO);
}

// ------------------------------------------------------------------ v2: próximo passo

export interface ProximoPasso {
  etapa: string;
  rotulo: string;
  extras?: { kit?: string | null; ensaio?: string | null };
}

/**
 * O caminho principal em 3 passos (1. Fotos do produto, com o produto
 * identificado ali mesmo, 2. Criar, 3. Usar, com a revisão dentro): a tela
 * sempre mostra o próximo passo.
 */
export function proximoPasso(e: { fotos: number; kits: KitDeFoto[]; kitId: string | null; ensaio: Ensaio | null; selecionadas: number }): ProximoPasso {
  if (e.fotos === 0) return { etapa: "acervo", rotulo: "Subir as fotos do produto" };
  if (!e.kits.length) {
    return { etapa: "acervo", rotulo: e.selecionadas ? `Identificar o produto (${e.selecionadas} ${e.selecionadas === 1 ? "foto" : "fotos"})` : "Identificar o produto" };
  }
  if (!e.kitId) return { etapa: "acervo", rotulo: "Escolher o produto" };
  if (!e.ensaio) return { etapa: "criar", rotulo: "Criar as fotos" };
  const r = resumoDoEnsaio(e.ensaio);
  const faltam = tomadasParaGerar(e.ensaio).filter((t) => !t.versoes.length).length;
  if (r.paraRevisar) return { etapa: "usar", rotulo: `Revisar ${r.paraRevisar} ${r.paraRevisar === 1 ? "foto" : "fotos"}`, extras: { ensaio: e.ensaio.id } };
  if (faltam) return { etapa: ehCampanha(e.ensaio) ? "campanha" : "ensaio", rotulo: `Gerar ${faltam} ${faltam === 1 ? "foto" : "fotos"}`, extras: { ensaio: e.ensaio.id } };
  if (r.aprovadas) return { etapa: "usar", rotulo: `Usar ${r.aprovadas} ${r.aprovadas === 1 ? "aprovada" : "aprovadas"}`, extras: { ensaio: e.ensaio.id } };
  return { etapa: "criar", rotulo: "Criar mais fotos" };
}

// ------------------------------------------------------------------ ligada à Mesa: campanhas do cliente

/** Campanha da Mesa (mesa_campanhas) como a função campanhas_listar devolve. */
export interface CampanhaDaMesa {
  id: string;
  nome: string;
  objetivo: string;
  conceito: string;
  status: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  periodo_pelo_calendario: boolean;
  tema_visual: string;
  paleta_apoio: { nome: string; hex: string }[];
  elementos: string;
  tom: string;
  no_mes: boolean;
  acontecendo_hoje: boolean;
  conteudos_no_mes: number;
  pautas_no_mes: string[];
  do_mes: boolean;
  motivo: string;
}

export interface CampanhasDaMesa {
  mes: string;
  campanhaDoMesId: string | null;
  campanhas: CampanhaDaMesa[];
}

const HEX_VALIDO = /^#[0-9a-f]{6}$/i;
const dataCurta = (d: string | null) => (d && d.length >= 10 ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");

export function normalizarCampanhaDaMesa(v: any): CampanhaDaMesa | null {
  if (!v || typeof v !== "object" || !texto(v.id)) return null;
  const id = v.identidade && typeof v.identidade === "object" ? v.identidade : v;
  const apoio: { nome: string; hex: string }[] = [];
  (Array.isArray(id.paleta_apoio) ? id.paleta_apoio : []).forEach((p: any) => {
    const hex = texto(p && p.hex).toUpperCase();
    if (HEX_VALIDO.test(hex) && apoio.length < 4) apoio.push({ nome: texto(p && p.nome), hex });
  });
  return {
    id: texto(v.id),
    nome: texto(v.nome) || "Campanha",
    objetivo: texto(v.objetivo),
    conceito: texto(v.conceito),
    status: texto(v.status) || "planejada",
    periodo_inicio: textoOuNulo(v.periodo_inicio),
    periodo_fim: textoOuNulo(v.periodo_fim),
    periodo_pelo_calendario: v.periodo_pelo_calendario === true,
    tema_visual: texto(id.tema_visual),
    paleta_apoio: apoio,
    elementos: texto(id.elementos),
    tom: texto(id.tom),
    no_mes: v.no_mes === true,
    acontecendo_hoje: v.acontecendo_hoje === true,
    conteudos_no_mes: numeroOuNulo(v.conteudos_no_mes) || 0,
    pautas_no_mes: listaDeTextos(v.pautas_no_mes),
    do_mes: v.do_mes === true,
    motivo: texto(v.motivo),
  };
}

export function normalizarCampanhasDaMesa(data: any): CampanhasDaMesa {
  const d = data && typeof data === "object" ? data : {};
  const campanhas: CampanhaDaMesa[] = [];
  (Array.isArray(d.campanhas) ? d.campanhas : []).forEach((b: any) => {
    const c = normalizarCampanhaDaMesa(b);
    if (c && !campanhas.some((x) => x.id === c.id)) campanhas.push(c);
  });
  const marcada = campanhas.find((c) => c.do_mes) || null;
  const doMes = texto(d.campanha_do_mes_id) || (marcada ? marcada.id : "");
  return { mes: texto(d.mes), campanhaDoMesId: doMes && campanhas.some((c) => c.id === doMes) ? doMes : null, campanhas };
}

/** "12/09 a 30/09" (com "pelo calendário" quando o período saiu das datas dos conteúdos). */
export function periodoDaCampanha(c: Pick<CampanhaDaMesa, "periodo_inicio" | "periodo_fim" | "periodo_pelo_calendario">): string {
  const i = dataCurta(c.periodo_inicio);
  const f = dataCurta(c.periodo_fim);
  const base = i && f ? (i === f ? i : `${i} a ${f}`) : i || f;
  return base ? `${base}${c.periodo_pelo_calendario ? " (pelo calendário)" : ""}` : "sem período";
}

export const chaveDasCampanhasDaMesa = (clientId: string) => ["mesa-foto", "campanhas-da-mesa", clientId];

/** As campanhas que a Mesa usa, com a do mês marcada pelo calendário (campanhas_listar, sem IA). */
export function useCampanhasDaMesa(clientId: string, ativo = true) {
  return useQuery({
    queryKey: chaveDasCampanhasDaMesa(clientId),
    enabled: ativo && !!clientId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<CampanhasDaMesa> => normalizarCampanhasDaMesa(await chamarFuncao<any>("mesa-foto", { acao: "campanhas_listar", client_id: clientId })),
  });
}

// ------------------------------------------------------------------ revisar dentro do resultado

export interface FotoParaRevisar {
  ensaio: Ensaio;
  tomada: Tomada;
  versao: VersaoDaTomada;
}

/**
 * A última versão de cada tomada que ainda espera decisão (sem versão
 * aprovada e a última não rejeitada), do ensaio pedido primeiro.
 */
export function fotosParaRevisar(ensaios: Ensaio[], primeiro?: string | null): FotoParaRevisar[] {
  const ordem = ensaios.slice().sort((a, b) => (a.id === primeiro ? -1 : b.id === primeiro ? 1 : 0));
  const saida: FotoParaRevisar[] = [];
  ordem.forEach((e) => {
    e.tomadas.forEach((t) => {
      if (!t.versoes.length || t.versoes.some((v) => v.aprovada)) return;
      const ultima = t.versoes[t.versoes.length - 1];
      if (!ultima.rejeitada && ultima.storage_path) saida.push({ ensaio: e, tomada: t, versao: ultima });
    });
  });
  return saida;
}

/** A foto do acervo de uma versão aprovada (versao_decidir grava imagem_id). */
export function fotoDaVersao(fotos: FotoDoAcervo[], v: Pick<VersaoDaTomada, "imagem_id" | "storage_path">): FotoDoAcervo | null {
  if (v.imagem_id) {
    const achada = fotos.find((f) => f.id === v.imagem_id);
    if (achada) return achada;
  }
  return v.storage_path ? fotos.find((f) => f.storage_path === v.storage_path) || null : null;
}

// ------------------------------------------------------------------ tirar fundo (25/09)

/**
 * "Tirar fundo" direto da foto (acervo e Preparar): preparar modo
 * fundo_transparente. O recorte preserva os pixels originais do assunto (do
 * gerador vem só a máscara, alinhada à foto) e a derivada fica no acervo com
 * o selo "sem fundo". Mesmo contrato que o Estúdio chama.
 */
export async function tirarFundo(clientId: string, imagemId: string): Promise<{ imagem: FotoDoAcervo | null; custo_usd?: number; aviso: string | null }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "preparar", client_id: clientId, imagem_id: imagemId, modo: "fundo_transparente" });
  return { imagem: normalizarFoto(data && data.imagem), custo_usd: data && data.custo_usd, aviso: data && typeof data.aviso === "string" ? data.aviso : null };
}

/** Foto que já é o recorte sem fundo (a derivada do Tirar fundo). */
export const ehSemFundo = (f: Pick<FotoDoAcervo, "tags">) => f.tags.indexOf("sem_fundo") >= 0 || f.tags.indexOf("preparo:fundo_transparente") >= 0;

/** Pode tirar o fundo: não é referência da internet nem já é recorte. */
export const podeTirarFundo = (f: Pick<FotoDoAcervo, "tags" | "referencia_web">) => !f.referencia_web && !ehSemFundo(f);

/** Foto real que pode virar clone ("Variações desta pessoa"): original, não gerada, não da internet. */
export const podeVirarClone = (f: Pick<FotoDoAcervo, "gerada" | "derivada_de" | "modo" | "referencia_web">) => !f.referencia_web && classeDaFoto(f) === "original";

// ------------------------------------------------------------------ biblioteca: exemplos em lote (admin, 25/09)

export interface EstimativaDosExemplos {
  pendentes: number;
  por_imagem_usd: number | null;
  total_usd: number | null;
  modelo_imagem_id: string;
  rotulo: string;
}

export async function estimarExemplosDaBiblioteca(clientId: string, refazerGerados = false): Promise<EstimativaDosExemplos> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "biblioteca_exemplos_estimar", client_id: clientId, refazer_gerados: refazerGerados });
  return {
    pendentes: Number(data && data.pendentes) || 0,
    por_imagem_usd: numeroOuNulo(data && data.por_imagem_usd),
    total_usd: numeroOuNulo(data && data.total_usd),
    modelo_imagem_id: texto(data && data.modelo_imagem_id),
    rotulo: texto(data && data.rotulo),
  };
}

export async function gerarProximoExemplo(clientId: string, refazerGerados = false): Promise<{ item: ItemDaBiblioteca | null; pendentes: number; acabou: boolean; custo_usd: number }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "biblioteca_exemplo_proximo", client_id: clientId, refazer_gerados: refazerGerados });
  return {
    item: normalizarItemDaBiblioteca(data && data.item),
    pendentes: Number(data && data.pendentes) || 0,
    acabou: !!(data && data.acabou),
    custo_usd: Number(data && data.custo_usd) || 0,
  };
}

export interface LimpezaDaBiblioteca {
  encontrados: number;
  limpos: number;
  a_limpar: number;
  confirmado: boolean;
  itens: { id: string; titulo: string; bate: number | null }[];
  aviso: string | null;
  custo_usd: number;
}

export async function limparExemplosDaBiblioteca(p: { modo: "openverse" | "nao_batem"; confirmar: boolean; clientId?: string }): Promise<LimpezaDaBiblioteca> {
  const corpo: Record<string, unknown> = { acao: "biblioteca_limpar_exemplos", modo: p.modo, confirmar: p.confirmar };
  if (p.clientId) corpo.client_id = p.clientId;
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  return {
    encontrados: Number(data && data.encontrados) || 0,
    limpos: Number(data && data.limpos) || 0,
    a_limpar: Number(data && data.a_limpar) || 0,
    confirmado: !!(data && data.confirmado),
    itens: (data && Array.isArray(data.itens) ? data.itens : []).map((i: any) => ({ id: texto(i.id), titulo: texto(i.titulo), bate: numeroOuNulo(i.bate) })),
    aviso: data && typeof data.aviso === "string" ? data.aviso : null,
    custo_usd: Number(data && data.custo_usd) || 0,
  };
}
