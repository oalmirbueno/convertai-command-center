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
export type ModoDaFoto = "preservar" | "luz_cor" | "cenario" | "angulo" | "ensaio";
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

export interface RefDoKit {
  imagem_id: string;
  papel: PapelDaRef;
  vista: string;
  prioridade: number;
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
    rotulo: "Fundo transparente",
    muda: "O fundo sai (PNG com transparência).",
    fica: "O assunto recortado, sem retoque.",
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

const MODOS_VALIDOS: ModoDaFoto[] = ["preservar", "luz_cor", "cenario", "angulo", "ensaio"];
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
  };
}

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
  if (f.gerada || f.modo === "angulo" || f.modo === "ensaio") return "gerada";
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
  return {
    imagem_id: id,
    papel: PAPEIS_VALIDOS.indexOf(papel as PapelDaRef) >= 0 ? (papel as PapelDaRef) : "identidade",
    vista: vistaValida(v.vista || v.observed_view),
    prioridade: numeroOuNulo(v.prioridade) === null ? 0 : Number(v.prioridade),
  };
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

export function normalizarProposta(v: any): PropostaDeKit | null {
  const k = normalizarKit(v);
  if (!k) return null;
  return { ...k, id: null, perguntas: listaDeTextos(v.perguntas || v.confirmar) };
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
  };
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
): Promise<{ propostas: PropostaDeKit[]; nao_agrupadas: { imagem_id: string; motivo: string }[]; custo_usd?: number }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "kit_sugerir", client_id: clientId, imagem_ids: imagemIds });
  const nao: { imagem_id: string; motivo: string }[] = [];
  if (data && Array.isArray(data.nao_agrupadas)) {
    for (const x of data.nao_agrupadas) {
      const id = texto(x && x.imagem_id);
      if (id) nao.push({ imagem_id: id, motivo: texto(x.motivo) });
    }
  }
  return { propostas: normalizarPropostas(data), nao_agrupadas: nao, custo_usd: data && data.custo_usd };
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
  refs.map((r, i) => ({ imagem_id: r.imagem_id, papel: r.papel, vista: vistaValida(r.vista) || null, prioridade: i }));

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
}): Promise<{ ensaio: Ensaio | null; estimativa_usd: number | null; custo_usd?: number }> {
  const data = await chamarFuncao<any>("mesa-foto", {
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
  storage_path: string | null;
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
    imagem_url: textoOuNulo(v.imagem_url),
    storage_path: textoOuNulo(v.storage_path),
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
    const titulo = texto(b.titulo || b.nome || b.resumo || b.texto);
    if (!titulo) return;
    // A função manda o porquê em "motivo" (e o termo da busca em "busca").
    const descricao = texto(b.motivo || b.descricao || b.detalhe || b.porque) || (b.busca ? `Buscar: ${texto(b.busca)}` : "");
    saida.push({ chave: texto(b.id) || `s-${i}`, tipo: texto(b.tipo) || "ajuste", titulo, descricao, bruto: b });
  });
  return saida;
}

/** A função lê até 4 fotos anexadas por mensagem ao diretor. */
export const MAX_ANEXOS_DO_DIRETOR = 4;

export async function conversarComDiretor(p: {
  clientId: string;
  mensagem: string;
  conversaId: string | null;
  kitId: string | null;
  ensaioId: string | null;
  anexos: string[];
}): Promise<{ resposta: string; sugestoes: SugestaoDoAgente[]; conversa_id: string | null; custo_usd: number | null }> {
  const corpo: Record<string, unknown> = { acao: "agente_conversar", client_id: p.clientId, mensagem: p.mensagem.trim() };
  if (p.conversaId) corpo.conversa_id = p.conversaId;
  if (p.kitId) corpo.kit_id = p.kitId;
  if (p.ensaioId) corpo.ensaio_id = p.ensaioId;
  if (p.anexos.length) corpo.anexos = p.anexos.slice(0, MAX_ANEXOS_DO_DIRETOR).map((id) => ({ imagem_id: id }));
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  return {
    resposta: texto(data && (data.resposta || data.texto)),
    sugestoes: normalizarSugestoes(data && data.sugestoes),
    conversa_id: textoOuNulo(data && data.conversa_id),
    custo_usd: numeroOuNulo(data && data.custo_usd),
  };
}

/** Sugestão que muda tomadas (só com um ensaio aberto); prompt e busca valem sem ensaio. */
export const sugestaoPedeEnsaio = (s: Pick<SugestaoDoAgente, "tipo">) => s.tipo === "tomada_nova" || s.tipo === "ajuste_tomada";

export async function aplicarSugestao(
  p: { clientId: string; ensaioId: string | null },
  sugestao: SugestaoDoAgente,
): Promise<{ ensaio: Ensaio | null; item: ItemDaBiblioteca | null; referencias: ReferenciaEncontrada[]; busca: string; custo_usd?: number }> {
  const corpo: Record<string, unknown> = { acao: "agente_aplicar", client_id: p.clientId, sugestao: sugestao.bruto };
  if (p.ensaioId) corpo.ensaio_id = p.ensaioId;
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  const referencias: ReferenciaEncontrada[] = [];
  if (data && Array.isArray(data.itens)) {
    data.itens.forEach((b: any, i: number) => {
      const n = normalizarEncontrada(b, i);
      if (n) referencias.push(n);
    });
  }
  return {
    ensaio: normalizarEnsaio(data && data.ensaio),
    item: normalizarItemDaBiblioteca(data && data.item),
    referencias,
    busca: texto(data && data.busca),
    custo_usd: data && data.custo_usd,
  };
}

export function partesDaConversa(catalogo: ModeloIa[]): ParteDaEstimativa[] {
  const m = padraoPara(catalogo, "diretor_arte");
  return [{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: 14000, tokensSaida: 1800 }];
}
