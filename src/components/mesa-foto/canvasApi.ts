import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, type ParteDaEstimativa, type Qualidade } from "@/lib/mesa/api";
import { decidirFoto, normalizarFoto, type FotoDoAcervo } from "./fotoApi";
import { normalizarConferenciaDaPersona, type ConferenciaDaPersona, type Persona, type Resolucao } from "./modelosApi";

/**
 * Canvas da Mesa Foto: o grafo (cartões e ligações) que o dono monta para
 * gerar "este produto, com esta pessoa, neste ambiente, nesta pegada"
 * (docs/mesa-foto/MODELOS-E-CANVAS.md, seções 6.4 a 6.6, 8.3 e 9.2).
 *
 * Tudo aqui é regra fixa em código, sem IA e sem React Flow (este arquivo
 * não importa o @xyflow/react: a lista do celular e os testes usam o mesmo
 * grafo sem carregar o quadro). A ordem das referências que valem é a da
 * função (canvas_montar); a da tela é a prévia com a mesma regra: produto,
 * pessoa, ambiente, estilo e o texto por último.
 *
 * Versão 3 (dono, 25/09): o Canvas é de composição. Pessoa = persona ou foto
 * real (com autorização); Ambiente em 3 modos (descrever, foto, contexto);
 * Agente (bolinha de conversa) que escreve o pedido; Resultado com ação,
 * pose/intenção e carrossel; "Variações desta" e o carrossel são N chamadas
 * de canvas_gerar (uma imagem por chamada, custo de todas à vista antes).
 *
 * Vídeo (em breve): só o lugar na paleta (TIPOS_FUTUROS). Contrato previsto
 * em supabase/functions/mesa-foto/canvas-regras.ts (cabeçalho): cartão
 * "video" ligado a um Resultado, dados { imagem_id, motor_video, duracao_s,
 * movimento, formato }, ações canvas_video_gerar e canvas_video_status.
 *
 * Cenas e história (dono, 25/09 à noite; docs/mesa-foto/cenas/PESQUISA.md):
 * um Resultado alimenta outro Resultado com um papel (personagem, produto,
 * cenário, estilo); o Resultado pode ser "cena" (dados.cena) e a História do
 * canvas é a lista das cenas pela ordem (./canvas/historia.ts). A pessoa
 * gerada vira personagem (criarPersonagem). A Mesa Vídeos lê o mesmo canvas
 * (docs/mesa-videos/CONTRATO.md); animacao fica reservada.
 */

// ------------------------------------------------------------------ tipos

export type TipoDeNo = "produto" | "modelo" | "ambiente" | "estilo" | "texto" | "gerar" | "agente";
export type Entrada = "produto" | "pessoa" | "ambiente" | "estilo" | "texto" | "agente";
export type ModoDoAmbiente = "descrever" | "foto" | "contexto";
export type UsoDaFotoDoAmbiente = "usar" | "complementar";

export interface ResultadoDoCanvas {
  geracao_id: string;
  imagem_id: string | null;
  storage_bucket: string;
  storage_path: string;
  url: string;
  motor_id: string;
  status: "gerando" | "gerada" | "falhou";
  erro: string;
  custo_usd: number;
  conferencia: ConferenciaDaPersona | null;
  criado_em: string;
  /** Série: as variações de uma foto ou as fotos de um carrossel têm o mesmo grupo. */
  grupo: string | null;
  quadro: number | null;
  tipo: "foto" | "variacao" | "carrossel";
}

/** O que a foto de um Resultado vira ao entrar noutro Resultado. */
export type PapelDaLigacao = "personagem" | "produto" | "cenario" | "estilo";

/** Animação da cena: reservado para a Mesa Vídeos (nada gera vídeo ainda). */
export interface AnimacaoDaCena {
  duracao_s: number | null;
  movimento: string | null;
  ultimo_quadro_id: string | null;
  audio: { fala: string | null; trilha: string | null; efeitos: string | null } | null;
  motor_video: string | null;
  status: "em_breve";
}

/** Resultado marcado como cena da história. */
export interface CenaDoResultado {
  ordem: number;
  titulo: string;
  acao: string;
  enquadramento: string;
  cenario: string;
  narrativa: string;
  seed: number | null;
  /** A foto da cena na história (na Mesa Vídeos, o 1º quadro). */
  imagem_id: string | null;
  animacao: AnimacaoDaCena | null;
}

/** Metadados da história do canvas (coluna foto_canvas.historia, SQL V-01). */
export interface HistoriaDoCanvas {
  sinopse: string;
  formato: string | null;
}

export interface MensagemDoAgente {
  papel: "usuario" | "agente";
  texto: string;
}

export interface DadosDoNo {
  /** Nome guardado no cartão (produto de outro cliente, pessoa real). */
  titulo?: string;
  kit_id?: string | null;
  modelo_id?: string | null;
  versao?: number | null;
  imagem_id?: string | null;
  /** Pessoa real: a equipe confirmou a autorização de uso da imagem. */
  autorizada?: boolean;
  biblioteca_id?: string | null;
  texto?: string;
  modo?: ModoDoAmbiente;
  uso?: UsoDaFotoDoAmbiente;
  papel?: "pedido" | "restricao";
  motores?: string[];
  formato?: string;
  qualidade?: Qualidade;
  resolucao?: Resolucao | null;
  acao?: string;
  pose?: string;
  /** 0 = foto solta; 3 a 6 = carrossel. */
  carrossel?: number;
  resultados?: ResultadoDoCanvas[];
  /** Agente: o pedido que ele escreveu (vai ao gerador) e a conversa curta. */
  pedido?: string;
  mensagens?: MensagemDoAgente[];
  /** Resultado: marcado como cena da história (null = fora da história). */
  cena?: CenaDoResultado | null;
}

export interface NoDoCanvas {
  id: string;
  tipo: TipoDeNo;
  x: number;
  y: number;
  dados: DadosDoNo;
}

export interface Ligacao {
  id: string;
  de: string;
  para: string;
  entrada: Entrada;
  ordem: number;
  /** Só na ligação de Resultado para Resultado: o papel da foto e a foto escolhida (null = a da cena ou a mais nova). */
  papel?: PapelDaLigacao;
  imagem_id?: string | null;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Canvas {
  id: string | null;
  client_id: string;
  nome: string;
  nos: NoDoCanvas[];
  ligacoes: Ligacao[];
  viewport: Viewport;
  versao: number;
  atualizado_em: string;
  historia?: HistoriaDoCanvas | null;
}

export interface ReferenciaMontada {
  ordem: number;
  papel: string;
  origem_tipo: string;
  origem_id: string;
  imagem_id: string | null;
  storage_path: string;
  storage_bucket: string;
  url: string;
  legenda: string;
}

export interface Montagem {
  referencias: ReferenciaMontada[];
  prompt: string;
  estimativa_usd: number | null;
  avisos: string[];
  /** Referências que ficaram de fora pelo limite do motor. */
  cortadas: number;
}

// ------------------------------------------------------------------ constantes

/**
 * Tamanho fixo dos cartões no quadro (px). Sem medir depois de montar: o
 * polyfill mínimo de ResizeObserver não percebe. v3: cartões compactos
 * (o dono achou "quadrado gigante").
 */
export const TAMANHO_DO_CARTAO = { largura: 200, altura: 88 };
/** O Resultado é maior: mostra o que junta, a foto gerada, o andamento e o botão de gerar. */
export const TAMANHO_DA_SAIDA = { largura: 280, altura: 412 };
/** O Agente é uma bolinha (com o nome embaixo). */
export const TAMANHO_DO_AGENTE = { largura: 76, altura: 92 };

export const tamanhoDoNo = (tipo: TipoDeNo) => (tipo === "gerar" ? TAMANHO_DA_SAIDA : tipo === "agente" ? TAMANHO_DO_AGENTE : TAMANHO_DO_CARTAO);

export const ORDEM_DAS_ENTRADAS: Entrada[] = ["produto", "pessoa", "ambiente", "estilo", "texto", "agente"];

/**
 * Cada papel tem a sua cor (a mesma no cartão, na alça e na linha). Cores
 * fixas (não dependem do tema): os cartões são pretos e legíveis sobre
 * qualquer fundo. Classes do Tailwind escritas por inteiro para o purge achar.
 */
export const TIPOS_DE_NO: Record<TipoDeNo, { rotulo: string; dica: string; entrada: Entrada | null; cor: string; borda: string; fundo: string; texto: string }> = {
  produto: { rotulo: "Produto", dica: "Um produto do kit (deste ou de outro cliente). Ele nunca muda na foto.", entrada: "produto", cor: "#22e57a", borda: "border-emerald-400/50", fundo: "bg-emerald-400/15", texto: "text-emerald-300" },
  modelo: { rotulo: "Pessoa", dica: "Uma modelo sintética (aba Modelos) ou a foto real de uma pessoa, com autorização.", entrada: "pessoa", cor: "#38bdf8", borda: "border-sky-400/50", fundo: "bg-sky-400/15", texto: "text-sky-300" },
  ambiente: { rotulo: "Ambiente", dica: "Descreva o lugar, use uma foto (como está ou complementada) ou gere pelo contexto do cliente.", entrada: "ambiente", cor: "#fbbf24", borda: "border-amber-400/50", fundo: "bg-amber-400/15", texto: "text-amber-300" },
  estilo: { rotulo: "Estilo", dica: "Referência de pegada: só paleta, luz e enquadramento.", entrada: "estilo", cor: "#e879f9", borda: "border-fuchsia-400/50", fundo: "bg-fuchsia-400/15", texto: "text-fuchsia-300" },
  texto: { rotulo: "Pedido", dica: "O que você quer na foto, em palavras (ou uma restrição).", entrada: "texto", cor: "#cbd5e1", borda: "border-slate-300/50", fundo: "bg-slate-300/15", texto: "text-slate-200" },
  agente: { rotulo: "Agente", dica: "Converse com o diretor de fotografia: ele lê o contexto do cliente e escreve o pedido do Resultado ligado.", entrada: "agente", cor: "#a78bfa", borda: "border-violet-400/50", fundo: "bg-violet-400/15", texto: "text-violet-300" },
  gerar: { rotulo: "Resultado", dica: "Junta os cartões ligados e gera a foto.", entrada: null, cor: "#f4f4f5", borda: "border-white/20", fundo: "bg-zinc-950", texto: "text-white" },
};

export const ROTULOS_DAS_ENTRADAS: Record<Entrada, string> = {
  produto: "Produto",
  pessoa: "Pessoa",
  ambiente: "Ambiente",
  estilo: "Estilo",
  texto: "Pedido",
  agente: "Agente",
};

export const TIPOS_DA_PALETA: TipoDeNo[] = ["produto", "modelo", "ambiente", "estilo", "texto", "agente", "gerar"];

/** Tipos que ainda não existem: aparecem desligados na paleta ("em breve"). */
export const TIPOS_FUTUROS: { chave: string; rotulo: string; dica: string }[] = [
  { chave: "video", rotulo: "Vídeo", dica: "Em breve: transformar a foto aprovada em vídeo curto (movimento de câmera, UGC)." },
];

// ------------------------------------------------------------------ composição (espelho de canvas-regras.ts)

/** Ação do Resultado (o que acontece entre as entradas). Chaves iguais às da função. */
export const ACOES_DO_RESULTADO: { valor: string; rotulo: string; dica: string }[] = [
  { valor: "livre", rotulo: "Livre", dica: "Só o pedido decide." },
  { valor: "na_mao", rotulo: "Na mão de", dica: "O produto na mão da pessoa, pegada natural." },
  { valor: "segurando", rotulo: "Segurando", dica: "Segura o produto virado para a câmera." },
  { valor: "olhando_para", rotulo: "Olhando para", dica: "A pessoa olha para o produto." },
  { valor: "no_ambiente", rotulo: "No ambiente", dica: "Produto e pessoa dentro do lugar, com luz e sombra reais." },
  { valor: "trocar_fundo", rotulo: "Trocar fundo", dica: "Mantém o assunto e troca só o fundo." },
];

/** Pose e intenção (campanha e preparo para UGC). */
export const POSES_DO_RESULTADO: { valor: string; rotulo: string; dica: string }[] = [
  { valor: "nenhuma", rotulo: "Sem pose", dica: "A pose sai do pedido." },
  { valor: "apresentando", rotulo: "Apresentando", dica: "Modelo apresentando o produto para a câmera." },
  { valor: "ugc_selfie", rotulo: "UGC selfie", dica: "Selfie de celular segurando o produto, pegada de review." },
  { valor: "uso_real", rotulo: "Uso real", dica: "Flagrante espontâneo usando o produto." },
  { valor: "close_mao", rotulo: "Close da mão", dica: "Macro da mão com o produto." },
];

/** Ângulos obrigatórios das variações e do carrossel (mesma ordem da função). */
export const ANGULOS_DE_VARIACAO = [
  "Frontal, plano médio",
  "Três quartos, plano americano",
  "Close no produto e nas mãos",
  "De cima, cena inteira",
  "Perfil, olhar fora",
  "De baixo, plano aberto",
];

export const OPCOES_DE_CARROSSEL = [0, 3, 4, 5, 6];

// ------------------------------------------------------------------ cenas (espelho de canvas-regras.ts)

/** Papel da foto de um Resultado quando ela entra noutro; a entrada é a alça onde a linha chega. */
export const PAPEIS_DA_LIGACAO: { valor: PapelDaLigacao; rotulo: string; dica: string; entrada: Entrada }[] = [
  { valor: "personagem", rotulo: "Personagem", dica: "A mesma pessoa desta foto, com a mesma roupa, em outra cena.", entrada: "pessoa" },
  { valor: "produto", rotulo: "Produto", dica: "O produto como aparece nesta foto.", entrada: "produto" },
  { valor: "cenario", rotulo: "Cenário", dica: "O mesmo lugar desta foto, com outra câmera.", entrada: "ambiente" },
  { valor: "estilo", rotulo: "Estilo", dica: "Só a paleta, a luz e o clima desta foto.", entrada: "estilo" },
];

export const rotuloDoPapel = (v?: string | null) => (PAPEIS_DA_LIGACAO.find((p) => p.valor === v) || PAPEIS_DA_LIGACAO[0]).rotulo;
export const lerPapelDaLigacao = (v: unknown): PapelDaLigacao => (PAPEIS_DA_LIGACAO.find((p) => p.valor === v) || PAPEIS_DA_LIGACAO[0]).valor;
const entradaDoPapel = (p: PapelDaLigacao): Entrada => (PAPEIS_DA_LIGACAO.find((x) => x.valor === p) || PAPEIS_DA_LIGACAO[0]).entrada;
/** A alça do Resultado onde a linha chegou diz o papel (pessoa = personagem, ambiente = cenário). */
export const papelDaAlca = (alca?: string | null): PapelDaLigacao => (PAPEIS_DA_LIGACAO.find((p) => p.entrada === alca) || PAPEIS_DA_LIGACAO[0]).valor;

/** Enquadramentos da cena (mesmas chaves da função). */
export const ENQUADRAMENTOS_DA_CENA: { valor: string; rotulo: string; dica: string }[] = [
  { valor: "livre", rotulo: "Livre", dica: "Sai do pedido." },
  { valor: "plano_geral", rotulo: "Plano geral", dica: "Corpo inteiro e o lugar. O rosto fica pequeno." },
  { valor: "plano_americano", rotulo: "Americano", dica: "Dos joelhos para cima." },
  { valor: "plano_medio", rotulo: "Plano médio", dica: "Da cintura para cima. Bom para a personagem." },
  { valor: "close", rotulo: "Close", dica: "Rosto e ombros." },
  { valor: "detalhe", rotulo: "Detalhe", dica: "Mãos e produto de perto." },
  { valor: "sobre_o_ombro", rotulo: "Sobre o ombro", dica: "Por cima do ombro da pessoa." },
  { valor: "pov", rotulo: "POV", dica: "O que a pessoa vê." },
];

/** Nós da Mesa Vídeos (em breve): o mesmo Canvas com estas opções a mais (docs/mesa-videos/CONTRATO.md). */
export const NOS_DE_VIDEO_EM_BREVE: { chave: string; rotulo: string; dica: string }[] = [
  { chave: "animar", rotulo: "Animar cena", dica: "A foto da cena vira o 1º quadro do vídeo." },
  { chave: "duracao", rotulo: "Duração", dica: "De 4 a 15 s por cena, conforme o motor de vídeo." },
  { chave: "camera", rotulo: "Câmera", dica: "Movimento: travelling, pan, órbita, zoom, câmera na mão." },
  { chave: "audio", rotulo: "Áudio", dica: "Fala, trilha e efeitos da cena." },
];

function normalizarAnimacao(v: any): AnimacaoDaCena | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const a = v.audio && typeof v.audio === "object" ? v.audio : null;
  const dur = Number(v.duracao_s);
  return {
    duracao_s: isFinite(dur) && dur > 0 ? dur : null,
    movimento: textoOuNulo(v.movimento),
    ultimo_quadro_id: textoOuNulo(v.ultimo_quadro_id),
    audio: a ? { fala: textoOuNulo(a.fala), trilha: textoOuNulo(a.trilha), efeitos: textoOuNulo(a.efeitos) } : null,
    motor_video: textoOuNulo(v.motor_video),
    status: "em_breve",
  };
}

export function normalizarCena(v: any): CenaDoResultado | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const ordem = Math.floor(Number(v.ordem));
  const seed = Number(v.seed);
  const enq = texto(v.enquadramento);
  return {
    ordem: isFinite(ordem) && ordem > 0 ? ordem : 1,
    titulo: texto(v.titulo),
    acao: texto(v.acao),
    enquadramento: ENQUADRAMENTOS_DA_CENA.some((e) => e.valor === enq) ? enq : "livre",
    cenario: texto(v.cenario),
    narrativa: texto(v.narrativa),
    seed: v.seed === null || v.seed === undefined || v.seed === "" || !isFinite(seed) || seed < 0 ? null : Math.floor(seed),
    imagem_id: textoOuNulo(v.imagem_id),
    animacao: normalizarAnimacao(v.animacao),
  };
}

export function normalizarHistoria(v: any): HistoriaDoCanvas | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return { sinopse: texto(v.sinopse), formato: textoOuNulo(v.formato) };
}
export const VARIACOES_POR_VEZ = 3;

export const rotuloDaAcao = (v?: string | null) => (ACOES_DO_RESULTADO.find((a) => a.valor === v) || ACOES_DO_RESULTADO[0]).rotulo;
export const rotuloDaPose = (v?: string | null) => (POSES_DO_RESULTADO.find((a) => a.valor === v) || POSES_DO_RESULTADO[0]).rotulo;

export const entradaDoTipo = (t: TipoDeNo): Entrada | null => TIPOS_DE_NO[t].entrada;

// ------------------------------------------------------------------ normalizadores

const texto = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const textoOuNulo = (v: unknown): string | null => {
  const t = texto(v).trim();
  return t ? t : null;
};
const numero = (v: unknown, padrao = 0): number => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !isFinite(n) ? padrao : n;
};

const TIPOS_VALIDOS = Object.keys(TIPOS_DE_NO) as TipoDeNo[];

export function normalizarResultado(v: any): ResultadoDoCanvas | null {
  if (!v || typeof v !== "object") return null;
  const id = texto(v.geracao_id || v.id);
  if (!id) return null;
  const status = texto(v.status);
  return {
    geracao_id: id,
    imagem_id: textoOuNulo(v.imagem_id),
    storage_bucket: texto(v.storage_bucket) || "mesa",
    storage_path: texto(v.storage_path),
    url: texto(v.url),
    motor_id: texto(v.motor_id || v.modelo_imagem_id),
    status: status === "gerando" || status === "falhou" ? status : "gerada",
    erro: texto(v.erro || v.ultimo_erro),
    custo_usd: numero(v.custo_usd),
    conferencia: normalizarConferenciaDaPersona(v.conferencia),
    criado_em: texto(v.criado_em),
    grupo: textoOuNulo(v.grupo),
    quadro: v.quadro === null || v.quadro === undefined || v.quadro === "" ? null : numero(v.quadro) || null,
    tipo: v.tipo === "variacao" || v.tipo === "carrossel" ? v.tipo : "foto",
  };
}

const lerCarrossel = (v: unknown) => {
  const n = Math.floor(Number(v));
  return isFinite(n) && n >= 3 ? Math.min(6, n) : 0;
};

function normalizarDados(tipo: TipoDeNo, v: any): DadosDoNo {
  const d = v && typeof v === "object" ? v : {};
  const saida: DadosDoNo = {};
  if (tipo === "produto") {
    saida.kit_id = textoOuNulo(d.kit_id);
    saida.titulo = texto(d.titulo);
  }
  if (tipo === "modelo") {
    saida.modelo_id = textoOuNulo(d.modelo_id);
    saida.versao = d.versao === undefined || d.versao === null ? null : numero(d.versao, 1);
    // Pessoa real (foto do acervo) só quando não há persona.
    saida.imagem_id = saida.modelo_id ? null : textoOuNulo(d.imagem_id);
    saida.autorizada = !saida.modelo_id && d.autorizada === true;
    saida.titulo = texto(d.titulo);
  }
  if (tipo === "ambiente" || tipo === "estilo") {
    // A função grava o estilo com listas (imagem_ids, biblioteca_ids) e o texto em "guia".
    saida.imagem_id = textoOuNulo(d.imagem_id || (Array.isArray(d.imagem_ids) ? d.imagem_ids[0] : null));
    saida.biblioteca_id = textoOuNulo(d.biblioteca_id || (Array.isArray(d.biblioteca_ids) ? d.biblioteca_ids[0] : null));
    saida.texto = texto(d.texto || d.guia);
  }
  if (tipo === "ambiente") {
    const m = texto(d.modo);
    saida.modo = m === "descrever" || m === "foto" || m === "contexto" ? m : saida.imagem_id ? "foto" : "descrever";
    saida.uso = texto(d.uso) === "usar" ? "usar" : "complementar";
  }
  if (tipo === "texto") {
    saida.texto = texto(d.texto);
    saida.papel = texto(d.papel) === "restricao" ? "restricao" : "pedido";
  }
  if (tipo === "agente") {
    saida.pedido = texto(d.pedido);
    saida.mensagens = (Array.isArray(d.mensagens) ? d.mensagens : [])
      .map((m: any) => ({ papel: (m && m.papel === "agente" ? "agente" : "usuario") as MensagemDoAgente["papel"], texto: texto(m && m.texto) }))
      .filter((m: MensagemDoAgente) => !!m.texto)
      .slice(-24);
  }
  if (tipo === "gerar") {
    saida.motores = Array.isArray(d.motores) ? d.motores.map(String).filter(Boolean) : [];
    saida.formato = texto(d.formato) || "4:5";
    const q = texto(d.qualidade);
    saida.qualidade = q === "baixa" || q === "media" || q === "alta" ? q : "alta";
    const r = texto(d.resolucao);
    saida.resolucao = r === "1K" || r === "2K" || r === "4K" ? r : null;
    const a = texto(d.acao);
    saida.acao = ACOES_DO_RESULTADO.some((x) => x.valor === a) ? a : "livre";
    const p = texto(d.pose);
    saida.pose = POSES_DO_RESULTADO.some((x) => x.valor === p) ? p : "nenhuma";
    saida.carrossel = lerCarrossel(d.carrossel);
    const resultados: ResultadoDoCanvas[] = [];
    if (Array.isArray(d.resultados)) {
      d.resultados.forEach((x: any) => {
        const n = normalizarResultado(x);
        if (n) resultados.push(n);
      });
    }
    saida.resultados = resultados;
    saida.cena = normalizarCena(d.cena);
  }
  return saida;
}

export function normalizarNo(v: any): NoDoCanvas | null {
  if (!v || typeof v !== "object" || !v.id) return null;
  const bruto = texto(v.tipo);
  const tipo = (bruto === "saida" ? "gerar" : bruto === "prompt" ? "texto" : bruto) as TipoDeNo;
  if (TIPOS_VALIDOS.indexOf(tipo) < 0) return null;
  const pos = v.position && typeof v.position === "object" ? v.position : v;
  return { id: String(v.id), tipo, x: numero(pos.x), y: numero(pos.y), dados: normalizarDados(tipo, v.dados || v.data) };
}

export function normalizarLigacao(v: any, nos: NoDoCanvas[]): Ligacao | null {
  if (!v || typeof v !== "object") return null;
  const de = texto(v.de || v.source);
  const para = texto(v.para || v.target);
  const origem = nos.find((n) => n.id === de);
  const destino = nos.find((n) => n.id === para);
  if (!origem || !destino || destino.tipo !== "gerar" || de === para) return null;
  const id = texto(v.id) || `lig-${de}-${para}`;
  if (origem.tipo === "gerar") {
    // Resultado alimentando Resultado (cena anterior): o papel escolhe a alça.
    const papel = lerPapelDaLigacao(v.papel);
    return { id, de, para, entrada: entradaDoPapel(papel), ordem: numero(v.ordem), papel, imagem_id: textoOuNulo(v.imagem_id) };
  }
  const entrada = entradaDoTipo(origem.tipo) as Entrada;
  return { id, de, para, entrada, ordem: numero(v.ordem) };
}

export function normalizarCanvas(v: any, clientId = ""): Canvas | null {
  if (!v || typeof v !== "object") return null;
  const nos: NoDoCanvas[] = [];
  (Array.isArray(v.nos) ? v.nos : Array.isArray(v.nodes) ? v.nodes : []).forEach((b: any) => {
    const n = normalizarNo(b);
    if (n && !nos.some((x) => x.id === n.id)) nos.push(n);
  });
  const ligacoes: Ligacao[] = [];
  (Array.isArray(v.ligacoes) ? v.ligacoes : Array.isArray(v.edges) ? v.edges : []).forEach((b: any) => {
    const l = normalizarLigacao(b, nos);
    if (l && !ligacoes.some((x) => x.de === l.de && x.para === l.para)) ligacoes.push(l);
  });
  const vp = v.viewport && typeof v.viewport === "object" ? v.viewport : {};
  return {
    id: textoOuNulo(v.id),
    client_id: texto(v.client_id) || clientId,
    nome: texto(v.nome) || "Canvas sem nome",
    nos,
    ligacoes,
    viewport: { x: numero(vp.x), y: numero(vp.y), zoom: numero(vp.zoom, 1) || 1 },
    versao: numero(v.versao, 0),
    atualizado_em: texto(v.atualizado_em || v.criado_em),
    historia: normalizarHistoria(v.historia),
  };
}

// ------------------------------------------------------------------ grafo

let contador = 0;
export function novoId(prefixo: string): string {
  contador += 1;
  return `${prefixo}-${Date.now().toString(36)}-${contador.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function novoNo(tipo: TipoDeNo, x: number, y: number, dados: DadosDoNo = {}): NoDoCanvas {
  const base = normalizarDados(tipo, dados);
  return { id: novoId(tipo), tipo, x: Math.round(x), y: Math.round(y), dados: { ...base, ...dados } };
}

export const canvasVazio = (clientId: string, nome = "Canvas novo"): Canvas => ({
  id: null,
  client_id: clientId,
  nome,
  nos: [],
  ligacoes: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  versao: 0,
  atualizado_em: "",
});

/** Algum caminho de Resultado para Resultado leva de `de` até `ate`? (para não fechar laço) */
export function alcancaPorResultados(c: Pick<Canvas, "nos" | "ligacoes">, de: string, ate: string): boolean {
  const resultados = c.nos.filter((n) => n.tipo === "gerar").map((n) => n.id);
  const vistos: string[] = [];
  const pilha = [de];
  while (pilha.length) {
    const atual = pilha.pop() as string;
    if (atual === ate) return true;
    if (vistos.indexOf(atual) >= 0) continue;
    vistos.push(atual);
    c.ligacoes.forEach((l) => {
      if (l.de === atual && resultados.indexOf(l.para) >= 0) pilha.push(l.para);
    });
  }
  return false;
}

/**
 * A entrada da ligação se ela é possível (destino que é Resultado, sem
 * repetir); senão null. Resultado com Resultado vale (cena anterior), com o
 * papel escolhido e sem laço.
 */
export function podeLigar(c: Pick<Canvas, "nos" | "ligacoes">, de: string, para: string, papel?: PapelDaLigacao | null): Entrada | null {
  if (!de || !para || de === para) return null;
  const origem = c.nos.find((n) => n.id === de);
  const destino = c.nos.find((n) => n.id === para);
  if (!origem || !destino || destino.tipo !== "gerar") return null;
  if (c.ligacoes.some((l) => l.de === de && l.para === para)) return null;
  if (origem.tipo === "gerar") return alcancaPorResultados(c, para, de) ? null : entradaDoPapel(papel || "personagem");
  return entradaDoTipo(origem.tipo);
}

/**
 * Liga (a ordem na mesma entrada é a ordem de chegada: prioridade). A entrada
 * sai do tipo do cartão, nunca da alça tocada; de Resultado para Resultado,
 * sai do papel (que a tela tira da alça onde a linha chegou).
 */
export function ligar<T extends Pick<Canvas, "nos" | "ligacoes">>(c: T, de: string, para: string, papel?: PapelDaLigacao | null): T {
  const entrada = podeLigar(c, de, para, papel);
  if (!entrada) return c;
  const ordem = c.ligacoes.filter((l) => l.para === para && l.entrada === entrada).length;
  const origem = c.nos.find((n) => n.id === de);
  const extra: Partial<Ligacao> = origem && origem.tipo === "gerar" ? { papel: papel || "personagem", imagem_id: null } : {};
  return { ...c, ligacoes: c.ligacoes.concat([{ id: novoId("lig"), de, para, entrada, ordem, ...extra }]) };
}

/** Troca o papel ou a foto de uma ligação entre Resultados (a entrada acompanha o papel; a ordem é refeita). */
export function mudarLigacao<T extends Pick<Canvas, "nos" | "ligacoes">>(c: T, ligacaoId: string, mudanca: { papel?: PapelDaLigacao; imagem_id?: string | null }): T {
  const ligacoes = c.ligacoes.map((l) => {
    if (l.id !== ligacaoId || !l.papel) return l;
    const papel = mudanca.papel || l.papel;
    const novo: Ligacao = { ...l, papel, entrada: entradaDoPapel(papel) };
    if (mudanca.imagem_id !== undefined) novo.imagem_id = mudanca.imagem_id;
    if (mudanca.papel && mudanca.papel !== l.papel) novo.ordem = 10_000;
    return novo;
  });
  return { ...c, ligacoes: renumerar(ligacoes) };
}

/** Reescreve a ordem 0, 1, 2... dentro de cada entrada de cada Resultado (depois de tirar uma ligação). */
export function renumerar(ligacoes: Ligacao[]): Ligacao[] {
  const contagem: Record<string, number> = {};
  return ligacoes
    .slice()
    .sort((a, b) => a.ordem - b.ordem)
    .map((l) => {
      const k = `${l.para}|${l.entrada}`;
      const ordem = contagem[k] || 0;
      contagem[k] = ordem + 1;
      return { ...l, ordem };
    });
}

export function desligar<T extends Pick<Canvas, "nos" | "ligacoes">>(c: T, ligacaoId: string): T {
  return { ...c, ligacoes: renumerar(c.ligacoes.filter((l) => l.id !== ligacaoId)) };
}

export function removerNo<T extends Pick<Canvas, "nos" | "ligacoes">>(c: T, noId: string): T {
  return { ...c, nos: c.nos.filter((n) => n.id !== noId), ligacoes: renumerar(c.ligacoes.filter((l) => l.de !== noId && l.para !== noId)) };
}

export function mudarDados<T extends Pick<Canvas, "nos">>(c: T, noId: string, dados: Partial<DadosDoNo>): T {
  return { ...c, nos: c.nos.map((n) => (n.id === noId ? { ...n, dados: { ...n.dados, ...dados } } : n)) };
}

export interface EntradaDoGerar {
  /** Número na ordem em que vai ao gerador (1, 2, 3...). */
  numero: number;
  entrada: Entrada;
  ligacao: Ligacao;
  no: NoDoCanvas;
}

/** As entradas de um Resultado na ordem em que vão ao gerador: produto, pessoa, ambiente, estilo, texto; dentro de cada, a ordem da ligação. */
export function entradasDoGerar(c: Pick<Canvas, "nos" | "ligacoes">, gerarId: string): EntradaDoGerar[] {
  const saida: EntradaDoGerar[] = [];
  ORDEM_DAS_ENTRADAS.forEach((entrada) => {
    c.ligacoes
      .filter((l) => l.para === gerarId && l.entrada === entrada)
      .sort((a, b) => a.ordem - b.ordem)
      .forEach((l) => {
        const no = c.nos.find((n) => n.id === l.de);
        if (no) saida.push({ numero: saida.length + 1, entrada, ligacao: l, no });
      });
  });
  return saida;
}

/** O que um cartão ainda precisa para valer (vazio: está pronto). */
export function faltaNoCartao(no: NoDoCanvas): string {
  const d = no.dados;
  if (no.tipo === "produto" && !d.kit_id) return "Escolha o produto";
  if (no.tipo === "modelo" && !d.modelo_id && !d.imagem_id) return "Escolha a pessoa";
  if (no.tipo === "modelo" && !d.modelo_id && d.imagem_id && !d.autorizada) return "Confirme a autorização da pessoa";
  if (no.tipo === "ambiente" && d.modo === "contexto") return "";
  if (no.tipo === "ambiente" && d.modo === "foto" && !d.imagem_id && !d.biblioteca_id) return "Escolha a foto do lugar";
  if ((no.tipo === "ambiente" || no.tipo === "estilo") && !d.imagem_id && !d.biblioteca_id && !(d.texto || "").trim()) return no.tipo === "ambiente" ? "Escolha uma foto ou descreva" : "Escolha uma referência ou descreva";
  if (no.tipo === "texto" && !(d.texto || "").trim()) return "Escreva o pedido";
  return "";
}

/**
 * Foto de um Resultado para entrar noutro (mesma regra da função): a
 * escolhida na ligação; senão a foto da cena; senão a mais nova aprovada;
 * senão a mais nova.
 */
export function fotoDaLigacao(no: Pick<NoDoCanvas, "dados">, escolhida?: string | null, aprovadas: string[] = []): ResultadoDoCanvas | null {
  const prontas = (no.dados.resultados || []).filter((r) => r.status === "gerada" && !!r.imagem_id);
  const porId = (id?: string | null) => (id ? prontas.find((r) => r.imagem_id === id) || null : null);
  const cena = no.dados.cena || null;
  const novas = prontas.slice().reverse();
  return porId(escolhida) || porId(cena && cena.imagem_id) || novas.find((r) => aprovadas.indexOf(String(r.imagem_id)) >= 0) || novas[0] || null;
}

/** Nome de um Resultado na tela: o título da cena, senão "Cena N" ou "Resultado N". */
export function nomeDoResultado(c: Pick<Canvas, "nos">, no: Pick<NoDoCanvas, "id" | "dados">): string {
  const cena = no.dados.cena || null;
  if (cena && cena.titulo.trim()) return cena.titulo.trim();
  const resultados = c.nos.filter((n) => n.tipo === "gerar");
  const i = resultados.findIndex((n) => n.id === no.id);
  return cena ? `Cena ${cena.ordem}` : `Resultado ${i >= 0 ? i + 1 : ""}`.trim();
}

/** Junta resultados novos no Resultado (sem repetir a mesma geração; guarda os 24 mais novos). */
export function juntarResultados(c: Canvas, porGerar: Record<string, ResultadoDoCanvas[]>): Canvas {
  let novo = c;
  Object.keys(porGerar).forEach((gerarId) => {
    const no = novo.nos.find((n) => n.id === gerarId);
    if (!no) return;
    const atuais = no.dados.resultados || [];
    const juntos = atuais.filter((a) => !porGerar[gerarId].some((p) => p.geracao_id === a.geracao_id)).concat(porGerar[gerarId]);
    novo = mudarDados(novo, gerarId, { resultados: juntos.slice(-24) });
  });
  return novo;
}

/**
 * Por que o Resultado ainda não gera (mesmas recusas da função, ditas antes):
 * sem produto e sem modelo; modelo sem âncora; cartão ligado incompleto;
 * nenhum motor ligado.
 */
export function bloqueiosDoGerar(c: Pick<Canvas, "nos" | "ligacoes">, gerarId: string, personas: Persona[] = []): string[] {
  const gerar = c.nos.find((n) => n.id === gerarId);
  if (!gerar || gerar.tipo !== "gerar") return ["Resultado não encontrado."];
  const entradas = entradasDoGerar(c, gerarId);
  const b: string[] = [];
  if (!entradas.some((e) => e.entrada === "produto" || e.entrada === "pessoa")) b.push("Adicione um produto ou uma pessoa.");
  entradas.forEach((e) => {
    if (e.no.tipo === "gerar") {
      if (!fotoDaLigacao(e.no, e.ligacao.imagem_id)) b.push(`${e.numero}. ${rotuloDoPapel(e.ligacao.papel)} de ${nomeDoResultado(c, e.no)}: gere a foto dele antes.`);
      return;
    }
    const falta = faltaNoCartao(e.no);
    if (falta) b.push(`${e.numero}. ${TIPOS_DE_NO[e.no.tipo].rotulo}: ${falta.toLowerCase()}.`);
    if (e.no.tipo === "modelo" && e.no.dados.modelo_id) {
      const p = personas.find((x) => x.id === e.no.dados.modelo_id);
      if (p && (p.status === "rascunho" || p.status === "candidatos")) b.push(`${e.numero}. A modelo ${p.nome} ainda não tem âncora escolhida (aba Modelos).`);
      if (p && p.status === "arquivada") b.push(`${e.numero}. A modelo ${p.nome} está arquivada.`);
    }
  });
  if (!(gerar.dados.motores || []).length) b.push("Escolha ao menos um motor nos ajustes.");
  return b;
}

/** Avisos que não impedem (modelo com folha incompleta). */
export function avisosDoGerar(c: Pick<Canvas, "nos" | "ligacoes">, gerarId: string, personas: Persona[] = []): string[] {
  const a: string[] = [];
  entradasDoGerar(c, gerarId).forEach((e) => {
    if (e.no.tipo !== "modelo") return;
    const p = personas.find((x) => x.id === e.no.dados.modelo_id);
    if (p && (p.status === "ancora" || p.status === "folha")) a.push(`A modelo ${p.nome} tem só a âncora (folha incompleta): o rosto pode variar mais.`);
  });
  return a;
}

/**
 * A frase do Resultado: "Junta: produto X + modelo Y + ambiente Z". O nome de
 * cada cartão vem de quem chama (a tela sabe o nome do kit e da modelo).
 */
export function resumoDoResultado(entradas: EntradaDoGerar[], nome: (no: NoDoCanvas) => string): string {
  if (!entradas.length) return "";
  const partes = entradas.map((e) => {
    if (e.no.tipo === "gerar") return `${rotuloDoPapel(e.ligacao.papel).toLowerCase()} de ${(nome(e.no) || "outra cena").trim()}`;
    const rotulo = TIPOS_DE_NO[e.no.tipo].rotulo.toLowerCase();
    const n = (nome(e.no) || "").trim();
    return n && n.toLowerCase() !== rotulo ? `${rotulo} ${n}` : `${rotulo} (a escolher)`;
  });
  return `Junta: ${partes.join(" + ")}`;
}

// ------------------------------------------------------------------ pôr cartões no quadro (ligação automática)

const VAO_X = 110;
const VAO_Y = 24;
const LINHAS_POR_COLUNA = 3;

const alturaDoNo = (n: Pick<NoDoCanvas, "tipo">) => tamanhoDoNo(n.tipo).altura;

/**
 * O Resultado que recebe o cartão novo: o pedido (o que está aberto na tela),
 * senão o primeiro. Null quando o quadro não tem Resultado.
 */
export function resultadoAlvo(c: Pick<Canvas, "nos">, preferido?: string | null): string | null {
  const resultados = c.nos.filter((n) => n.tipo === "gerar");
  if (preferido && resultados.some((n) => n.id === preferido)) return preferido;
  return resultados.length ? resultados[0].id : null;
}

/**
 * Onde o cartão novo fica: em colunas de 3 à esquerda do Resultado, centradas
 * nele, na primeira vaga livre (sem cartão em cima de cartão).
 */
export function posicaoParaCartao(c: Pick<Canvas, "nos">, gerarId: string): { x: number; y: number } {
  const g = c.nos.find((n) => n.id === gerarId);
  if (!g) return { x: 0, y: c.nos.length * (TAMANHO_DO_CARTAO.altura + VAO_Y) };
  const altura = LINHAS_POR_COLUNA * TAMANHO_DO_CARTAO.altura + (LINHAS_POR_COLUNA - 1) * VAO_Y;
  const topo = g.y + TAMANHO_DA_SAIDA.altura / 2 - altura / 2;
  const ocupada = (x: number, y: number) => c.nos.some((n) => n.id !== gerarId && Math.abs(n.x - x) < 80 && Math.abs(n.y - y) < 80);
  for (let i = 0; i < 60; i++) {
    const coluna = Math.floor(i / LINHAS_POR_COLUNA);
    const linha = i % LINHAS_POR_COLUNA;
    const x = Math.round(g.x - (coluna + 1) * (TAMANHO_DO_CARTAO.largura + VAO_X / 2) - VAO_X / 2);
    const y = Math.round(topo + linha * (TAMANHO_DO_CARTAO.altura + VAO_Y));
    if (!ocupada(x, y)) return { x, y };
  }
  return { x: g.x - TAMANHO_DO_CARTAO.largura - VAO_X, y: g.y };
}

/** Um Resultado a mais fica abaixo de tudo o que já está no quadro. */
export function posicaoParaResultado(c: Pick<Canvas, "nos">): { x: number; y: number } {
  if (!c.nos.length) return { x: 420, y: 0 };
  const resultados = c.nos.filter((n) => n.tipo === "gerar");
  const x = resultados.length ? Math.max.apply(null, resultados.map((n) => n.x)) : 420;
  const fundo = Math.max.apply(null, c.nos.map((n) => n.y + alturaDoNo(n)));
  return { x, y: Math.round(fundo + 120) };
}

/**
 * Põe um cartão (criado fora, com id já dado) no quadro. Cartão de entrada já
 * se liga sozinho ao Resultado (o pedido ou o primeiro); sem Resultado no
 * quadro, entra o de reserva e o cartão se liga nele. Ligar à mão continua
 * possível (vários Resultados), mas não é necessário.
 */
export function porCartao<T extends Pick<Canvas, "nos" | "ligacoes">>(
  c: T,
  no: NoDoCanvas,
  o: { gerarId?: string | null; resultadoReserva?: NoDoCanvas | null; posicao?: { x: number; y: number } | null } = {},
): T {
  if (no.tipo === "gerar") {
    const p = o.posicao || posicaoParaResultado(c);
    return { ...c, nos: c.nos.concat([{ ...no, x: Math.round(p.x), y: Math.round(p.y) }]) };
  }
  let novo: T = c;
  let alvo = resultadoAlvo(c, o.gerarId);
  if (!alvo && o.resultadoReserva && o.resultadoReserva.tipo === "gerar") {
    const p = posicaoParaResultado(novo);
    novo = { ...novo, nos: novo.nos.concat([{ ...o.resultadoReserva, x: p.x, y: p.y }]) };
    alvo = o.resultadoReserva.id;
  }
  const p = o.posicao || (alvo ? posicaoParaCartao(novo, alvo) : { x: no.x, y: no.y });
  novo = { ...novo, nos: novo.nos.concat([{ ...no, x: Math.round(p.x), y: Math.round(p.y) }]) };
  return alvo ? ligar(novo, no.id, alvo) : novo;
}

/** Resultado sem nenhum cartão ligado (um modelo pronto pode usar ele). */
export const resultadoVazio = (c: Pick<Canvas, "ligacoes">, gerarId: string) => !c.ligacoes.some((l) => l.para === gerarId);

// ------------------------------------------------------------------ modelos prontos (galeria)

export interface CartaoDoModeloPronto {
  tipo: Exclude<TipoDeNo, "gerar">;
  dados?: DadosDoNo;
}

export interface ModeloPronto {
  chave: string;
  rotulo: string;
  dica: string;
  cartoes: CartaoDoModeloPronto[];
  /** Ajustes que o modelo põe no Resultado (ação, pose, carrossel, formato). */
  resultado?: Partial<DadosDoNo>;
  /** Cores da miniatura (gradiente) enquanto a capa de verdade não chega. */
  cores: [string, string];
  /**
   * Capa (estático do front, public/canvas-modelos/<chave>.webp, com um .jpg
   * de mesmo nome para navegador sem webp). Sai das fotos de base que o dono
   * subiu na Mesa Foto, reduzidas a 640 px, sem metadado e sem a marca do
   * produto: a galeria vale para todos os clientes. Sem capa, a miniatura
   * desenha os cartões do modelo sobre o gradiente.
   */
  capa?: string | null;
}

/** Capa pública do modelo pronto (arquivo em public/canvas-modelos). */
const capaDoModelo = (chave: string) => `/canvas-modelos/${chave}.webp`;

/** A mesma capa em jpg, para Safari 11 a 13 (sem webp). */
export const capaDeReserva = (capa: string) => capa.replace(/\.webp$/, ".jpg");

/**
 * Referência de estilo de um modelo pronto: a foto de base que o dono subiu
 * no acervo de um cliente. Só entra quando o Canvas é desse mesmo cliente (a
 * função também recusa imagem de acervo de outro cliente).
 */
export interface ReferenciaDeEstiloDoModelo {
  chave: string;
  client_id: string;
  imagem_id: string;
}

/** Ensaio de 24/09 no acervo do cliente dono das fotos de base (tomadas na mão, flat lay e rotina de trabalho). */
const CLIENTE_DAS_FOTOS_DE_BASE = "6a847578-ba39-44cd-be61-08e34e18e4c9";

export const REFERENCIAS_DE_ESTILO_DOS_MODELOS: ReferenciaDeEstiloDoModelo[] = [
  { chave: "produto-na-mao", client_id: CLIENTE_DAS_FOTOS_DE_BASE, imagem_id: "4d5cf2df-f329-4f42-a267-4ed8a2636a6d" },
  { chave: "flat-lay", client_id: CLIENTE_DAS_FOTOS_DE_BASE, imagem_id: "ecfc7b8a-2f14-4421-b195-ae98154fcb8c" },
  { chave: "produto-no-ambiente", client_id: CLIENTE_DAS_FOTOS_DE_BASE, imagem_id: "2be68898-cc48-46e4-957b-1eb9acc27b15" },
];

/** A referência de estilo do modelo para este cliente, ou null (outro cliente nunca recebe). */
export function referenciaDeEstiloDoModelo(chave: string, clientId: string | null | undefined): ReferenciaDeEstiloDoModelo | null {
  if (!clientId) return null;
  return REFERENCIAS_DE_ESTILO_DOS_MODELOS.find((r) => r.chave === chave && r.client_id === clientId) || null;
}

/** Guia do cartão Estilo que o modelo pronto põe com a foto de base. */
export const GUIA_DA_REFERENCIA_DO_MODELO = "Use a foto só como referência de pegada: paleta, luz e enquadramento. O produto é o do cartão Produto.";

/** O que o modelo pronto põe no Resultado (ação, pose, formato e carrossel). */
function ajusteDoModelo(acao: string | null, pose: string | null, formato: string, carrossel = 0): Partial<DadosDoNo> {
  const d: Partial<DadosDoNo> = { formato };
  if (acao) d.acao = acao;
  if (pose) d.pose = pose;
  if (carrossel) d.carrossel = carrossel;
  return d;
}

/** Quadros que montam em 1 clique: os cartões já ligados ao Resultado, com a ação e a pose certas. */
export const MODELOS_PRONTOS: ModeloPronto[] = [
  {
    chave: "produto-na-mao",
    rotulo: "Produto na mão",
    dica: "A pessoa segura o produto perto do rosto, produto nítido em primeiro plano.",
    cores: ["#0f766e", "#22e57a"],
    capa: capaDoModelo("produto-na-mao"),
    resultado: ajusteDoModelo("na_mao", "apresentando", "4:5"),
    cartoes: [
      { tipo: "produto" },
      { tipo: "modelo" },
      { tipo: "texto", dados: { texto: "A pessoa segura o produto na mão, perto do rosto, com o produto em primeiro plano, nítido e inteiro.", papel: "pedido" } },
    ],
  },
  {
    chave: "produto-na-praia",
    rotulo: "Produto na praia",
    dica: "O produto em destaque na areia, luz dourada do fim da tarde.",
    cores: ["#0369a1", "#fbbf24"],
    resultado: ajusteDoModelo("no_ambiente", null, "4:5"),
    cartoes: [
      { tipo: "produto" },
      { tipo: "ambiente", dados: { modo: "descrever", texto: "Praia ao fim da tarde, areia clara, mar ao fundo, luz dourada lateral." } },
      { tipo: "texto", dados: { texto: "O produto em destaque na areia, apoiado numa canga ou numa pedra, com sombra de contato real e o mar desfocado ao fundo.", papel: "pedido" } },
    ],
  },
  {
    chave: "loja-da-marca",
    rotulo: "Na loja da marca",
    dica: "Mande a foto da loja: a pessoa apresenta o produto no lugar real, ambientado.",
    cores: ["#1f2937", "#a78bfa"],
    resultado: ajusteDoModelo("segurando", "apresentando", "4:5"),
    cartoes: [
      { tipo: "produto" },
      { tipo: "modelo" },
      { tipo: "ambiente", dados: { modo: "foto", uso: "usar" } },
      { tipo: "texto", dados: { texto: "A pessoa dentro da loja, apresentando o produto perto do balcão, a loja reconhecível e bem iluminada ao fundo.", papel: "pedido" } },
    ],
  },
  {
    chave: "ugc-selfie",
    rotulo: "UGC selfie",
    dica: "Selfie de celular segurando o produto, pegada de review para vídeo UGC.",
    cores: ["#be185d", "#f59e0b"],
    resultado: ajusteDoModelo("segurando", "ugc_selfie", "9:16"),
    cartoes: [
      { tipo: "produto" },
      { tipo: "modelo" },
      { tipo: "texto", dados: { texto: "Em casa, ela mostra o produto para a câmera do celular como num review, falando com quem assiste, luz da janela.", papel: "pedido" } },
    ],
  },
  {
    chave: "flat-lay",
    rotulo: "Flat lay",
    dica: "Visto de cima, produto no centro com objetos da rotina.",
    cores: ["#78350f", "#fde68a"],
    capa: capaDoModelo("flat-lay"),
    resultado: ajusteDoModelo("livre", "nenhuma", "1:1"),
    cartoes: [
      { tipo: "produto" },
      { tipo: "estilo", dados: { texto: "Flat lay visto de cima, superfície de linho ou madeira clara, objetos de cena da rotina, sombra suave de janela." } },
      { tipo: "texto", dados: { texto: "Composição flat lay vista de cima, produto no centro e objetos coerentes com a marca ao redor, com respiro.", papel: "pedido" } },
    ],
  },
  {
    chave: "vitrine",
    rotulo: "Vitrine",
    dica: "O produto numa vitrine com a cara da marca (ambiente pelo contexto).",
    cores: ["#312e81", "#38bdf8"],
    resultado: ajusteDoModelo("no_ambiente", null, "4:5"),
    cartoes: [
      { tipo: "produto" },
      { tipo: "ambiente", dados: { modo: "contexto" } },
      { tipo: "texto", dados: { texto: "O produto exposto numa vitrine de loja bem iluminada, prateleira limpa, reflexo leve do vidro, sem texto inventado.", papel: "pedido" } },
    ],
  },
  {
    chave: "carrossel-de-produto",
    rotulo: "Carrossel de produto",
    dica: "5 fotos coerentes: capa, detalhe, uso, ambiente e fechamento.",
    cores: ["#065f46", "#e879f9"],
    capa: capaDoModelo("carrossel-de-produto"),
    resultado: ajusteDoModelo("segurando", "nenhuma", "4:5", 5),
    cartoes: [
      { tipo: "produto" },
      { tipo: "modelo" },
      { tipo: "ambiente", dados: { modo: "contexto" } },
      { tipo: "texto", dados: { texto: "Sequência de campanha com a mesma pessoa, o mesmo produto e o mesmo lugar, contando o uso do produto do começo ao fim.", papel: "pedido" } },
    ],
  },
  {
    chave: "produto-no-ambiente",
    rotulo: "Produto no ambiente",
    dica: "O produto em destaque num lugar com a cara da marca. Escolha a foto do lugar.",
    cores: ["#44403c", "#fbbf24"],
    capa: capaDoModelo("produto-no-ambiente"),
    resultado: ajusteDoModelo("no_ambiente", null, "4:5"),
    cartoes: [
      { tipo: "produto" },
      { tipo: "ambiente" },
      { tipo: "texto", dados: { texto: "O produto em destaque no ambiente, apoiado numa superfície real, com sombra de contato e as cores da marca no cenário.", papel: "pedido" } },
    ],
  },
  {
    chave: "modelo-na-rua",
    rotulo: "Pessoa na rua",
    dica: "Foto espontânea de rua, com luz natural do fim da tarde.",
    cores: ["#374151", "#38bdf8"],
    resultado: ajusteDoModelo(null, "uso_real", "4:5"),
    cartoes: [
      { tipo: "produto" },
      { tipo: "modelo" },
      { tipo: "ambiente", dados: { modo: "descrever", texto: "Rua da cidade com calçada e fachadas, luz natural do fim da tarde." } },
      { tipo: "texto", dados: { texto: "A pessoa usa o produto enquanto caminha pela rua, foto espontânea de lifestyle.", papel: "pedido" } },
    ],
  },
];

/** Os 3 primeiros aparecem no Resultado vazio; a galeria mostra todos. */
export const MODELOS_EM_DESTAQUE = ["produto-na-mao", "ugc-selfie", "produto-na-praia"];

/**
 * Monta o modelo pronto: usa o Resultado que ainda não tem nada ligado (o do
 * centro, num quadro novo) ou cria outro abaixo. O que o dono tem de um só
 * (um kit, uma modelo) vem preenchido; o resto fica para escolher. O
 * Resultado recebe a ação, a pose, o formato e o carrossel do modelo.
 */
export function aplicarModeloPronto(
  c: Canvas,
  chave: string,
  motorPadrao: string | null,
  preencher: { kit_id?: string | null; modelo_id?: string | null; versao?: number | null; pedido?: string | null; ambiente?: string | null } = {},
): Canvas {
  const m = MODELOS_PRONTOS.find((x) => x.chave === chave);
  if (!m) return c;
  let novo: Canvas = { ...c };
  const livre = novo.nos.find((n) => n.tipo === "gerar" && resultadoVazio(novo, n.id));
  let gerarId: string;
  if (livre) gerarId = livre.id;
  else {
    const g = novoNo("gerar", 0, 0, { motores: motorPadrao ? [motorPadrao] : [] });
    novo = porCartao(novo, g);
    gerarId = g.id;
  }
  if (m.resultado) novo = mudarDados(novo, gerarId, m.resultado);
  // Foto de base do dono como referência de estilo: só no Canvas do cliente
  // dono da foto. Entra no cartão Estilo do modelo (mantém o guia dele) ou
  // num cartão Estilo novo antes do pedido.
  const ref = referenciaDeEstiloDoModelo(m.chave, c.client_id);
  let cartoes = m.cartoes;
  if (ref) {
    const i = cartoes.findIndex((x) => x.tipo === "estilo");
    if (i >= 0) cartoes = cartoes.map((x, j) => (j === i ? { ...x, dados: { ...(x.dados || {}), imagem_id: ref.imagem_id } } : x));
    else {
      const estilo: CartaoDoModeloPronto = { tipo: "estilo", dados: { imagem_id: ref.imagem_id, texto: GUIA_DA_REFERENCIA_DO_MODELO } };
      const t = cartoes.findIndex((x) => x.tipo === "texto");
      cartoes = t >= 0 ? cartoes.slice(0, t).concat([estilo], cartoes.slice(t)) : cartoes.concat([estilo]);
    }
  }
  cartoes.forEach((cartao) => {
    const dados: DadosDoNo = { ...(cartao.dados || {}) };
    if (cartao.tipo === "produto" && preencher.kit_id) dados.kit_id = preencher.kit_id;
    if (cartao.tipo === "modelo" && preencher.modelo_id) {
      dados.modelo_id = preencher.modelo_id;
      dados.versao = preencher.versao || null;
    }
    if (cartao.tipo === "texto" && preencher.pedido) dados.texto = preencher.pedido;
    if (cartao.tipo === "ambiente" && preencher.ambiente && dados.modo !== "foto") {
      dados.modo = "descrever";
      dados.texto = preencher.ambiente;
    }
    novo = porCartao(novo, novoNo(cartao.tipo, 0, 0, dados), { gerarId });
  });
  return novo;
}

// ------------------------------------------------------------------ agente do Canvas

export interface RespostaDoAgenteDoCanvas {
  resposta: string;
  pedido: string;
  acao: string | null;
  pose: string | null;
  ambiente: string | null;
  formato: string | null;
  modelo_pronto: string | null;
  kit_id: string | null;
  modelo_id: string | null;
  custo_usd: number | null;
}

export function normalizarRespostaDoAgente(data: any): RespostaDoAgenteDoCanvas {
  const d = data && typeof data === "object" ? data : {};
  const ou = (v: unknown) => textoOuNulo(v);
  return {
    resposta: texto(d.resposta) || "Sem resposta do agente.",
    pedido: texto(d.pedido),
    acao: ACOES_DO_RESULTADO.some((a) => a.valor === d.acao) ? String(d.acao) : null,
    pose: POSES_DO_RESULTADO.some((a) => a.valor === d.pose) ? String(d.pose) : null,
    ambiente: ou(d.ambiente),
    formato: ou(d.formato),
    modelo_pronto: MODELOS_PRONTOS.some((m) => m.chave === d.modelo_pronto) ? String(d.modelo_pronto) : null,
    kit_id: ou(d.kit_id),
    modelo_id: ou(d.modelo_id),
    custo_usd: d.custo_usd === undefined || d.custo_usd === null ? null : numero(d.custo_usd),
  };
}

/** Corpo de canvas_agente (JSON puro): o canvas salvo, a tarefa e o histórico curto. */
export function corpoDoAgente(p: { canvasId: string; gerarId?: string | null; mensagem?: string; tarefa?: "conversar" | "ambiente" | "montar"; historico?: MensagemDoAgente[] }): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "canvas_agente", canvas_id: p.canvasId, tarefa: p.tarefa || "conversar" };
  if (p.gerarId) corpo.no_saida_id = p.gerarId;
  if (p.mensagem && p.mensagem.trim()) corpo.mensagem = p.mensagem.trim();
  if (p.historico && p.historico.length) corpo.historico = p.historico.slice(-12).map((m) => ({ papel: m.papel, texto: m.texto.slice(0, 2000) }));
  return corpo;
}

export async function conversarNoCanvas(p: Parameters<typeof corpoDoAgente>[0]): Promise<RespostaDoAgenteDoCanvas> {
  return normalizarRespostaDoAgente(await chamarFuncao<any>("mesa-foto", corpoDoAgente(p)));
}

/**
 * Põe a resposta do agente no quadro: a conversa e o pedido no cartão do
 * agente; a ação, a pose e o formato no Resultado ligado (quando vieram).
 */
export function aplicarRespostaDoAgente(c: Canvas, agenteId: string, mensagem: string, r: RespostaDoAgenteDoCanvas): Canvas {
  const agente = c.nos.find((n) => n.id === agenteId);
  if (!agente) return c;
  const conversa = (agente.dados.mensagens || [])
    .concat(mensagem.trim() ? [{ papel: "usuario" as const, texto: mensagem.trim() }] : [])
    .concat([{ papel: "agente" as const, texto: r.resposta }])
    .slice(-24);
  let novo = mudarDados(c, agenteId, { mensagens: conversa, pedido: r.pedido || agente.dados.pedido || "" });
  c.ligacoes
    .filter((l) => l.de === agenteId)
    .forEach((l) => {
      const ajuste: Partial<DadosDoNo> = {};
      if (r.acao) ajuste.acao = r.acao;
      if (r.pose) ajuste.pose = r.pose;
      if (r.formato && ["1:1", "4:5", "9:16", "16:9"].indexOf(r.formato) >= 0) ajuste.formato = r.formato;
      if (Object.keys(ajuste).length) novo = mudarDados(novo, l.para, ajuste);
    });
  return novo;
}

/**
 * "Montar pelo contexto": o agente escolhe o modelo pronto, o produto, a
 * pessoa, o ambiente e escreve o pedido; a tela monta o quadro com isso.
 */
export function montarPelaResposta(c: Canvas, r: RespostaDoAgenteDoCanvas, motorPadrao: string | null, padrao: { kit_id?: string | null; modelo_id?: string | null; versao?: number | null } = {}): Canvas {
  const chave = r.modelo_pronto || (r.pose === "ugc_selfie" ? "ugc-selfie" : "produto-na-mao");
  const antes = c;
  let novo = aplicarModeloPronto(c, chave, motorPadrao, {
    kit_id: r.kit_id || padrao.kit_id || null,
    modelo_id: r.modelo_id || padrao.modelo_id || null,
    versao: r.modelo_id ? null : padrao.versao || null,
    pedido: r.pedido || null,
    ambiente: r.ambiente || null,
  });
  const g = novo.nos.find((n) => n.tipo === "gerar" && novo.ligacoes.some((l) => l.para === n.id && !antes.ligacoes.some((x) => x.id === l.id)));
  if (g) {
    const ajuste: Partial<DadosDoNo> = {};
    if (r.acao) ajuste.acao = r.acao;
    if (r.pose) ajuste.pose = r.pose;
    if (Object.keys(ajuste).length) novo = mudarDados(novo, g.id, ajuste);
  }
  return novo;
}

// ------------------------------------------------------------------ rascunho local

const chaveDoRascunho = (clientId: string, id: string | null) => `mesa-foto:canvas:${clientId}:${id || "novo"}`;

export function guardarRascunho(c: Canvas) {
  try {
    window.localStorage.setItem(chaveDoRascunho(c.client_id, c.id), JSON.stringify({ canvas: c, em: Date.now() }));
  } catch {
    /* sem armazenamento: o servidor guarda */
  }
}

export function lerRascunho(clientId: string, id: string | null): Canvas | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(chaveDoRascunho(clientId, id)) || "null");
    return v && v.canvas ? normalizarCanvas(v.canvas, clientId) : null;
  } catch {
    return null;
  }
}

export function apagarRascunho(clientId: string, id: string | null) {
  try {
    window.localStorage.removeItem(chaveDoRascunho(clientId, id));
  } catch {
    /* nada a apagar */
  }
}

// ------------------------------------------------------------------ leituras e ações

export const chaveDosCanvases = (clientId: string) => ["mesa-foto", "canvases", clientId];

export function useCanvases(clientId: string) {
  return useQuery({
    queryKey: chaveDosCanvases(clientId),
    enabled: !!clientId,
    staleTime: 20_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async (): Promise<Canvas[]> => {
      const { data, error } = await (supabase as any)
        .from("foto_canvas")
        .select("*")
        .eq("client_id", clientId)
        .order("atualizado_em", { ascending: false })
        .limit(100);
      if (error) {
        const msg = String(error.message || "");
        if (String(error.code) === "42P01" || String(error.code) === "PGRST205" || msg.indexOf("does not exist") >= 0 || msg.indexOf("Could not find the table") >= 0) {
          throw new Error("O banco do Canvas ainda não foi publicado (tabela foto_canvas). Dá para montar e ver o quadro; salvar e gerar esperam a publicação.");
        }
        throw error instanceof Error ? error : new Error(msg || "Não foi possível ler os canvases.");
      }
      const saida: Canvas[] = [];
      for (const b of (data || []) as any[]) {
        const c = normalizarCanvas(b, clientId);
        if (c && (b as any).status !== "arquivado") saida.push(c);
      }
      return saida;
    },
  });
}

/**
 * Nome de cada cartão na função (canvas-regras.ts, TIPOS_DE_NO). A tela chama
 * o prompt de "texto" e o resultado de "gerar"; a função aceita os dois, mas
 * grava e devolve estes.
 */
export const TIPO_NA_FUNCAO: Record<TipoDeNo, string> = {
  produto: "produto",
  modelo: "modelo",
  ambiente: "ambiente",
  estilo: "estilo",
  texto: "prompt",
  gerar: "saida",
  agente: "agente",
};

/** Dados de um cartão na forma que a função grava (canvas-regras.ts, dadosDoNo). */
export function dadosParaAFuncao(tipo: TipoDeNo, d: DadosDoNo): Record<string, unknown> {
  if (tipo === "produto") return { kit_id: d.kit_id || null, titulo: (d.titulo || "").trim() || null };
  if (tipo === "modelo") {
    return { modelo_id: d.modelo_id || null, versao: d.versao || null, imagem_id: d.modelo_id ? null : d.imagem_id || null, autorizada: !d.modelo_id && !!d.autorizada, titulo: (d.titulo || "").trim() || null };
  }
  if (tipo === "ambiente") {
    return { imagem_id: d.imagem_id || null, biblioteca_id: d.biblioteca_id || null, texto: (d.texto || "").trim() || null, modo: d.modo || (d.imagem_id ? "foto" : "descrever"), uso: d.uso === "usar" ? "usar" : "complementar" };
  }
  if (tipo === "estilo") {
    return { imagem_ids: d.imagem_id ? [d.imagem_id] : [], biblioteca_ids: d.biblioteca_id ? [d.biblioteca_id] : [], guia: (d.texto || "").trim() || null };
  }
  if (tipo === "texto") return { texto: d.texto || "", papel: d.papel === "restricao" ? "restricao" : "pedido" };
  if (tipo === "agente") return { pedido: (d.pedido || "").trim(), mensagens: (d.mensagens || []).slice(-24).map((m) => ({ papel: m.papel, texto: m.texto.slice(0, 2000) })) };
  // Resultado: as fotos vão junto (a função guarda o atalho, sem a URL assinada, que expira).
  return {
    motores: d.motores || [],
    formato: d.formato || "4:5",
    qualidade: d.qualidade || "alta",
    resolucao: d.resolucao || null,
    acao: d.acao || "livre",
    pose: d.pose || "nenhuma",
    carrossel: d.carrossel || 0,
    cena: d.cena ? cenaParaAFuncao(d.cena) : null,
    resultados: (d.resultados || []).map((r) => ({
      geracao_id: r.geracao_id,
      imagem_id: r.imagem_id,
      storage_bucket: r.storage_bucket,
      storage_path: r.storage_path,
      motor_id: r.motor_id,
      status: r.status,
      erro: r.erro,
      custo_usd: r.custo_usd,
      conferencia: r.conferencia,
      criado_em: r.criado_em,
      grupo: r.grupo,
      quadro: r.quadro,
      tipo: r.tipo,
    })),
  };
}

/** Cena na forma da função (canvas-regras.ts, lerCena); a animação vai só quando existe (reservado). */
export function cenaParaAFuncao(c: CenaDoResultado): Record<string, unknown> {
  return {
    ordem: c.ordem,
    titulo: c.titulo.trim() || null,
    acao: c.acao.trim() || null,
    enquadramento: c.enquadramento || "livre",
    cenario: c.cenario.trim() || null,
    narrativa: c.narrativa.trim() || null,
    seed: c.seed,
    imagem_id: c.imagem_id,
    animacao: c.animacao,
  };
}

/** O corpo que vai para canvas_salvar (JSON puro, nomes e forma da função). */
export function corpoDoCanvas(c: Canvas) {
  const corpo: Record<string, unknown> = {
    nome: c.nome.trim() || "Canvas sem nome",
    nos: c.nos.map((n) => ({ id: n.id, tipo: TIPO_NA_FUNCAO[n.tipo], x: Math.round(n.x), y: Math.round(n.y), dados: dadosParaAFuncao(n.tipo, n.dados) })),
    // A entrada (produto, pessoa...) sai do tipo do cartão de origem: a função não guarda. Entre Resultados vão o papel e a foto.
    ligacoes: c.ligacoes.map((l) => (l.papel ? { id: l.id, de: l.de, para: l.para, ordem: l.ordem, papel: l.papel, imagem_id: l.imagem_id || null } : { id: l.id, de: l.de, para: l.para, ordem: l.ordem })),
    viewport: { x: Math.round(c.viewport.x), y: Math.round(c.viewport.y), zoom: Math.round(c.viewport.zoom * 1000) / 1000 },
  };
  if (c.id) corpo.id = c.id;
  if (c.historia && (c.historia.sinopse.trim() || c.historia.formato)) corpo.historia = { sinopse: c.historia.sinopse.trim() || null, formato: c.historia.formato || null };
  return corpo;
}

/** Salva; a versão esperada evita pisar no que outra aba gravou (erro canvas_mudou). */
export async function salvarCanvas(c: Canvas): Promise<Canvas> {
  const corpo: Record<string, unknown> = { acao: "canvas_salvar", client_id: c.client_id, canvas: corpoDoCanvas(c) };
  if (c.id) corpo.versao_esperada = c.versao;
  const data = await chamarFuncao<any>("mesa-foto", corpo);
  const salvo = normalizarCanvas(data && (data.canvas || data), c.client_id);
  if (!salvo || !salvo.id) return { ...c };
  // Sem a coluna da história no banco (SQL V-01), a sinopse fica só na tela e no rascunho local.
  if (!salvo.historia && c.historia) salvo.historia = c.historia;
  // A função devolve o grafo gravado; os resultados que chegaram enquanto salvava ficam (a tela é quem os tem).
  return { ...salvo, nos: salvo.nos.length || !c.nos.length ? salvo.nos : c.nos };
}

export function normalizarMontagem(data: any): Montagem {
  const d = data && typeof data === "object" ? (data.montagem && typeof data.montagem === "object" ? data.montagem : data.compilado && typeof data.compilado === "object" ? data.compilado : data) : {};
  const referencias: ReferenciaMontada[] = [];
  (Array.isArray(d.referencias) ? d.referencias : []).forEach((r: any, i: number) => {
    if (!r || typeof r !== "object") return;
    const origem = r.origem && typeof r.origem === "object" ? r.origem : {};
    referencias.push({
      ordem: numero(r.ordem, i + 1) || i + 1,
      papel: texto(r.papel),
      origem_tipo: texto(origem.tipo || r.origem_tipo),
      origem_id: texto(origem.id || r.origem_id),
      imagem_id: textoOuNulo(r.imagem_id),
      storage_path: texto(r.storage_path),
      storage_bucket: texto(r.storage_bucket) || "mesa",
      url: texto(r.url),
      legenda: [texto(r.titulo), texto(r.legenda || r.nome)].filter(Boolean).join(", "),
    });
  });
  referencias.sort((a, b) => a.ordem - b.ordem);
  const est = d.estimativa_usd ?? (data && data.estimativa_usd);
  // A função devolve as cortadas como lista (uma por referência que ficou de fora).
  const cortadas = Array.isArray(d.cortadas) ? d.cortadas.length : numero(d.cortadas || d.referencias_cortadas);
  return {
    referencias,
    prompt: texto(d.prompt),
    estimativa_usd: est === null || est === undefined || est === "" || !isFinite(Number(est)) ? null : Number(est),
    avisos: (Array.isArray(d.avisos) ? d.avisos : []).map((x: any) => texto(x)).filter(Boolean),
    cortadas,
  };
}

/**
 * Corpo de canvas_montar e canvas_gerar (canvas.ts, montar): o canvas salvo,
 * o cartão de resultado (no_saida_id) e o gerador (modelo_imagem_id). Formato
 * e qualidade de base vêm do Resultado salvo; a qualidade daqui vale por cima.
 */
/** Série (v3): foto base, ângulo obrigatório, posição no carrossel e o grupo que junta as fotos. */
export interface PedidoDaSerie {
  baseImagemId?: string | null;
  angulo?: number | null;
  quadro?: number | null;
  quadros?: number | null;
  grupo?: string | null;
}

export interface PedidoDoCanvas extends PedidoDaSerie {
  canvasId: string;
  gerarId: string;
  motorId: string;
  qualidade: Qualidade;
  resolucao?: Resolucao | null;
}

export function corpoDoPedidoDoCanvas(acao: "canvas_montar" | "canvas_gerar", p: PedidoDoCanvas): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao, canvas_id: p.canvasId, no_saida_id: p.gerarId, modelo_imagem_id: p.motorId, qualidade: p.qualidade };
  if (p.resolucao) corpo.resolucao = p.resolucao;
  if (p.baseImagemId) corpo.base_imagem_id = p.baseImagemId;
  if (p.angulo !== null && p.angulo !== undefined) corpo.angulo = p.angulo;
  if (p.quadro && p.quadros) {
    corpo.quadro = p.quadro;
    corpo.quadros = p.quadros;
  }
  if (p.grupo) corpo.grupo = p.grupo;
  return corpo;
}

export async function montarCanvas(p: PedidoDoCanvas): Promise<Montagem> {
  return normalizarMontagem(await chamarFuncao<any>("mesa-foto", corpoDoPedidoDoCanvas("canvas_montar", p)));
}

export async function gerarNoCanvas(p: PedidoDoCanvas): Promise<{ resultado: ResultadoDoCanvas; imagem: FotoDoAcervo | null; custo_usd?: number }> {
  const data = await chamarFuncao<any>("mesa-foto", corpoDoPedidoDoCanvas("canvas_gerar", p));
  const imagem = normalizarFoto(data && data.imagem);
  const g = data && data.geracao && typeof data.geracao === "object" ? data.geracao : {};
  const resultado = normalizarResultado({
    ...g,
    geracao_id: g.id || g.geracao_id || (data && data.geracao_id) || (imagem ? `img-${imagem.id}` : novoId("geracao")),
    imagem_id: g.imagem_id || (imagem ? imagem.id : null),
    storage_bucket: imagem ? imagem.storage_bucket : g.storage_bucket,
    storage_path: imagem ? imagem.storage_path : g.storage_path,
    url: (data && data.url) || g.url,
    motor_id: g.motor_id || p.motorId,
    status: g.status === "falhou" ? "falhou" : "gerada",
    custo_usd: data && data.custo_usd,
    grupo: p.grupo || null,
    quadro: p.quadro || null,
    tipo: p.quadro ? "carrossel" : p.baseImagemId ? "variacao" : "foto",
  }) as ResultadoDoCanvas;
  return { resultado, imagem, custo_usd: data && data.custo_usd };
}

/** Nome do arquivo baixado: sempre com "gerada" (foto sintética não sai sem a marca). */
export function nomeParaBaixar(nome: string, caminho: string): string {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(caminho || "") || ["", "png"])[1].toLowerCase();
  const base = (nome || "foto-do-canvas")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^A-Za-z0-9À-ÿ _-]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "foto-do-canvas";
  return `${base.toLowerCase().indexOf("gerada") >= 0 ? base : `${base}-gerada`}.${ext}`;
}

/** Baixa uma foto do Resultado (link assinado de download, sem passar pelo ZIP). */
export async function baixarImagem(bucket: string, caminho: string, nome: string): Promise<void> {
  const arquivo = nomeParaBaixar(nome, caminho);
  const { data, error } = await (supabase.storage.from(bucket || "mesa") as any).createSignedUrl(caminho, 600, { download: arquivo });
  if (error || !data || !data.signedUrl) throw new Error("Não foi possível baixar a foto agora. Tente de novo.");
  const a = document.createElement("a");
  a.href = String(data.signedUrl);
  a.download = arquivo;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function conferirGeracao(geracaoId: string): Promise<{ conferencia: ConferenciaDaPersona | null; custo_usd?: number }> {
  const data = await chamarFuncao<any>("mesa-foto", { acao: "canvas_conferir", geracao_id: geracaoId });
  return { conferencia: normalizarConferenciaDaPersona(data), custo_usd: data && data.custo_usd };
}

// ------------------------------------------------------------------ personagem persistente

export interface PedidoDePersonagem {
  clientId: string;
  imagemId: string;
  nome: string;
  idade: number;
  descricao?: string;
  invariantes?: string[];
}

/** Corpo de canvas_personagem_criar (a ética é confirmada pela equipe no formulário). */
export function corpoDoPersonagem(p: PedidoDePersonagem): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    acao: "canvas_personagem_criar",
    client_id: p.clientId,
    imagem_id: p.imagemId,
    nome: p.nome.trim(),
    idade_aparente: Math.round(p.idade),
    etica_confirmada: true,
  };
  if (p.descricao && p.descricao.trim()) corpo.descricao = p.descricao.trim();
  const inv = (p.invariantes || []).map((x) => x.trim()).filter(Boolean);
  if (inv.length) corpo.invariantes = inv.slice(0, 12);
  return corpo;
}

export interface PersonagemCriada {
  modelo_id: string;
  nome: string;
  motor_id: string | null;
  folha_sugerida: string[];
  estimativa_vista_usd: number | null;
  avisos: string[];
}

/**
 * A pessoa gerada vira personagem (persona com a foto como âncora). Sem IA e
 * sem custo; a folha sai depois, uma vista por vez, com o custo à vista.
 */
export async function criarPersonagem(p: PedidoDePersonagem): Promise<PersonagemCriada> {
  const data = await chamarFuncao<any>("mesa-foto", corpoDoPersonagem(p));
  const pers = data && data.personagem && typeof data.personagem === "object" ? data.personagem : {};
  const est = data ? data.estimativa_vista_usd : null;
  return {
    modelo_id: texto(pers.id),
    nome: texto(pers.nome) || p.nome.trim(),
    motor_id: textoOuNulo(pers.motor_preferido_id),
    folha_sugerida: Array.isArray(data && data.folha_sugerida) ? data.folha_sugerida.map(String) : ["frente", "tres_quartos_esq", "perfil_esq", "meio_corpo"],
    estimativa_vista_usd: est === null || est === undefined || !isFinite(Number(est)) ? null : Number(est),
    avisos: Array.isArray(data && data.avisos) ? data.avisos.map((x: unknown) => texto(x)).filter(Boolean) : [],
  };
}

/** Personagem nascida no Canvas (origem 'personagem', ou a marca nas notas da ficha sem o SQL V-01). */
export const MARCA_DO_PERSONAGEM = "Personagem do Canvas";
export const ehPersonagem = (p: Pick<Persona, "ficha">) => !!p.ficha && (p.ficha.notas || "").indexOf(MARCA_DO_PERSONAGEM) === 0;

// ------------------------------------------------------------------ estimativas

const ENTRADA_POR_REFERENCIA = 1600;

/** Uma imagem por motor ligado no Resultado (uma chamada por motor). */
export function partesDoGerar(motores: string[], qualidade: Qualidade, referencias: number): ParteDaEstimativa[] {
  return motores.map((id) => ({ modeloId: id, tipo: "imagem" as const, imagens: 1, qualidade, tokensEntrada: 3000 + referencias * ENTRADA_POR_REFERENCIA }));
}

/**
 * Série (variações ou carrossel): N chamadas no mesmo motor. A partir da
 * segunda foto do carrossel (e em toda variação) a foto base vai junto.
 */
export function partesDaSerie(motorId: string, qualidade: Qualidade, referencias: number, vezes: number, comBaseDesdeAPrimeira = false): ParteDaEstimativa[] {
  const saida: ParteDaEstimativa[] = [];
  for (let i = 0; i < vezes; i++) {
    const refs = referencias + (comBaseDesdeAPrimeira || i > 0 ? 1 : 0);
    saida.push({ modeloId: motorId, tipo: "imagem" as const, imagens: 1, qualidade, tokensEntrada: 3000 + refs * ENTRADA_POR_REFERENCIA });
  }
  return saida;
}

/** O que o botão Gerar do Resultado vai gastar: um por motor, ou o carrossel inteiro no primeiro motor. */
export function partesDoResultado(no: Pick<NoDoCanvas, "dados">, referencias: number): ParteDaEstimativa[] {
  const motores = no.dados.motores || [];
  const q: Qualidade = no.dados.qualidade || "alta";
  const n = no.dados.carrossel || 0;
  if (n && motores.length) return partesDaSerie(motores[0], q, referencias, n);
  return partesDoGerar(motores, q, referencias);
}

// ------------------------------------------------------------------ usar e finalizar

/**
 * "Usar na Mesa" e "Finalizar" em 1 clique: aprova a foto se ainda não foi
 * aprovada (a Mesa e o cliente só recebem foto aprovada) e devolve a foto
 * atualizada. Foto já aprovada não chama nada.
 */
export async function aprovarSePreciso(clientId: string, imagemId: string, jaAprovada: boolean): Promise<FotoDoAcervo | null> {
  if (jaAprovada) return null;
  return decidirFoto(clientId, imagemId, "aprovar");
}

export const enderecoDaMesa = (clientId: string, imagemIds: string[]) => `/mesa?client=${clientId}&aba=estudio&fotos=${imagemIds.join(",")}`;

// ------------------------------------------------------------------ esteira de produtos (topo do quadro)

export interface ProdutoDaEsteira {
  kit_id: string;
  client_id: string;
  nome: string;
  variante: string | null;
  tipo: string;
  capa: { bucket: string; caminho: string } | null;
}

/** "todos": todos os clientes que a equipe enxerga (o RLS de foto_kits filtra). */
export const TODOS_OS_CLIENTES = "todos";

async function lerProdutosDaEsteira(filtro: { clientId?: string | null; ids?: string[] }): Promise<ProdutoDaEsteira[]> {
  let q = (supabase as any).from("foto_kits").select("id, client_id, nome, variante, tipo, status, frente_imagem_id, atualizado_em");
  if (filtro.ids) q = q.in("id", filtro.ids);
  else if (filtro.clientId && filtro.clientId !== TODOS_OS_CLIENTES) q = q.eq("client_id", filtro.clientId);
  const { data, error } = await q.order("atualizado_em", { ascending: false }).limit(filtro.ids ? 60 : 80);
  if (error) throw error instanceof Error ? error : new Error(String(error.message || "Não foi possível ler os produtos."));
  const kits = ((data || []) as any[]).filter((k) => k && k.id && k.tipo !== "pessoa" && k.status !== "arquivado");
  const semFrente = kits.filter((k) => !k.frente_imagem_id).map((k) => String(k.id));
  let refs: any[] = [];
  if (semFrente.length) {
    const r = await (supabase as any).from("foto_kit_refs").select("kit_id, imagem_id, papel, prioridade").in("kit_id", semFrente);
    refs = (r && r.data) || [];
  }
  const capaId = (k: any) =>
    k.frente_imagem_id ||
    (refs.filter((r) => String(r.kit_id) === String(k.id)).sort((a, b) => (a.papel === "identidade" ? 0 : 1) - (b.papel === "identidade" ? 0 : 1) || numero(a.prioridade) - numero(b.prioridade))[0] || { imagem_id: null }).imagem_id;
  const ids = kits.map(capaId).filter(Boolean).map(String);
  let imagens: any[] = [];
  if (ids.length) {
    const r = await (supabase as any).from("cliente_imagens").select("id, storage_bucket, storage_path").in("id", ids);
    imagens = (r && r.data) || [];
  }
  return kits.map((k) => {
    const img = imagens.find((i) => String(i.id) === String(capaId(k) || ""));
    return {
      kit_id: String(k.id),
      client_id: texto(k.client_id),
      nome: texto(k.nome) || "Produto",
      variante: textoOuNulo(k.variante),
      tipo: texto(k.tipo),
      capa: img && img.storage_path ? { bucket: texto(img.storage_bucket) || "mesa", caminho: texto(img.storage_path) } : null,
    };
  });
}

export function useEsteira(clienteDoFiltro: string, ativo = true) {
  return useQuery({
    queryKey: ["mesa-foto", "canvas", "esteira", clienteDoFiltro],
    enabled: ativo && !!clienteDoFiltro,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: () => lerProdutosDaEsteira({ clientId: clienteDoFiltro }),
  });
}

/** Produtos citados no quadro que não são deste cliente (vieram da esteira): nome e capa. */
export function useProdutosDeFora(ids: string[]) {
  const chave = ids.slice().sort().join(",");
  return useQuery({
    queryKey: ["mesa-foto", "canvas", "produtos-de-fora", chave],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: () => lerProdutosDaEsteira({ ids }),
  });
}
