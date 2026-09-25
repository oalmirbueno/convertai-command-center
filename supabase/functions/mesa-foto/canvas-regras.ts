/**
 * Área "Canvas" da Mesa Foto: regras puras do quadro de cartões ligados
 * (docs/mesa-foto/MODELOS-E-CANVAS.md, seções 6.4 a 6.6 e 8.3). Sem rede,
 * sem banco e sem Deno: a função (canvas.ts) usa e o teste do painel importa.
 *
 * Tipos de nó: produto (kit), modelo (persona), ambiente (foto ou descrição),
 * estilo (referência ou biblioteca), prompt (texto) e saida (resultado).
 * Ligação: { id, de, para, ordem }, sempre de um nó de entrada para um nó
 * saida; a ordem das ligações do mesmo papel é a prioridade.
 *
 * Montagem do pedido (regra fixa, sem IA): referências em ordem de papel
 * (produto do kit como identidade invariante, persona como identidade da
 * pessoa, ambiente e estilo só como estilo), orçamento por papel dentro do
 * limite do gerador, prompt com índice das imagens, invariantes do kit e da
 * ficha, hiper-realismo quando há pessoa, proibições e o texto livre.
 *
 * Versão 3 (dono, 25/09): o Canvas é de composição, não só de modelo.
 * - "modelo" é o cartão Pessoa: persona sintética (modelo_id) OU foto real de
 *   pessoa do acervo do cliente (imagem_id), que só vale com autorizada true.
 * - "ambiente" tem 3 modos: descrever (texto), foto (usar o lugar como está ou
 *   complementar) e contexto (o lugar sai da marca e do nicho do cliente).
 * - "agente" (bolinha de conversa) liga no resultado e entra como pedido: o
 *   texto que o agente escreveu (dados.pedido) vai no PEDIDO.
 * - "saida" ganha a ação da composição (na mão de, segurando, olhando para,
 *   no ambiente, trocar fundo), a pose/intenção (apresentando, UGC selfie, uso
 *   real, close da mão) e o carrossel (3 a 6 fotos coerentes).
 * - Variações e carrossel: o pedido de gerar pode trazer a foto base
 *   (identidade da cena), o ângulo obrigatório e a posição no carrossel.
 * - Produto de outro cliente: vale se a equipe tem acesso ao cliente do kit
 *   (a função confere can_access_client); a cobrança é sempre do cliente do canvas.
 *
 * Vídeo (em breve, sem código ainda): cartão "video" ligado a um resultado,
 * dados { imagem_id (foto aprovada do resultado), motor_video, duracao_s,
 * movimento, formato } e ação canvas_video_gerar { canvas_id, no_video_id }
 * -> { job_id } com consulta canvas_video_status. Não entra em TIPOS_DE_NO
 * até existir: canvas com esse cartão é recusado.
 */

import { ErroDeRegra, limpo, listaDeTextos, semTravessao, UUID } from "./calculos.ts";
import { FORMATOS, type Formato } from "./receitas.ts";
import { BLOCO_HIPER_REALISMO, type FichaDaPersona, fichaEmTexto, garantirPermitido, PROIBICOES_DA_PERSONA } from "./personas.ts";

export const TIPOS_DE_NO = ["produto", "modelo", "ambiente", "estilo", "prompt", "saida", "agente"] as const;
export type TipoDeNo = typeof TIPOS_DE_NO[number];

// ------------------------------------------------------------------ composição (v3)

/** O que acontece entre as entradas no resultado (a "ação" da composição). */
export const ACOES_DO_RESULTADO: Record<string, string> = {
  livre: "",
  na_mao: "O produto está na mão da pessoa, com pegada natural (dedos visíveis, corretos e relaxados), o produto nítido, inteiro e na escala real.",
  segurando: "A pessoa segura o produto na altura do peito ou perto do rosto, virado para a câmera, rótulo legível, com as mãos do jeito real de segurar.",
  olhando_para: "A pessoa olha para o produto com interesse genuíno (olhar no produto, não na câmera), expressão natural.",
  no_ambiente: "O produto (e a pessoa, se houver) está dentro do ambiente, com perspectiva, escala, luz e sombra de contato coerentes com o lugar; nada parece colado.",
  trocar_fundo: "Mantenha o assunto como está (mesma pose, mesmo produto, mesma roupa) e troque só o fundo pelo ambiente, com a luz do assunto casada com o novo lugar.",
};

/** Pose e intenção (preparo para UGC e campanha). */
export const POSES_DO_RESULTADO: Record<string, string> = {
  nenhuma: "",
  apresentando: "POSE: modelo apresentando o produto para a câmera, como em campanha: produto estendido ou perto do rosto, rótulo virado para a lente, sorriso leve, olhar na câmera, postura aberta.",
  ugc_selfie: "POSE UGC: selfie feita pela própria pessoa, braço estendido segurando o celular (lente frontal), a outra mão segura o produto perto do rosto, falando com a câmera como num vídeo de review; enquadramento vertical, fundo real de casa ou do dia a dia.",
  uso_real: "POSE: uso real do produto no dia a dia, flagrante espontâneo, sem olhar para a câmera, gesto no meio da ação.",
  close_mao: "POSE: close da mão segurando o produto, macro com profundidade de campo curta; pele da mão com textura real, unhas naturais, produto em foco total.",
};

/** Poses com pegada de celular (lente e luz de smartphone no lugar do retrato 85 mm). */
export const POSES_UGC = ["ugc_selfie"];

export const LENTE_UGC = "LENTE E LUZ DE CELULAR: foto de smartphone (lente de 24 a 26 mm equivalente, foco em tudo, leve distorção de grande angular perto das bordas), luz ambiente real da casa ou da rua, balanço de branco do lugar, ruído fino de sensor pequeno; nada de estúdio, nada de fundo desfocado artificial.";

/** Ângulos obrigatórios das variações e do carrossel (um diferente por foto da série). */
export const ANGULOS_DE_VARIACAO = [
  "plano médio frontal, câmera na altura dos olhos",
  "três quartos pela esquerda, plano americano",
  "close fechado no produto e nas mãos, fundo desfocado",
  "de cima para baixo (plongée leve), cena inteira",
  "perfil pela direita, olhar fora da câmera",
  "contra-plongée leve, plano aberto com o ambiente",
];

/** O papel de cada foto do carrossel, na ordem (3 a 6 fotos). */
export const QUADROS_DO_CARROSSEL = [
  "capa: a foto de impacto, pessoa e produto bem claros",
  "detalhe do produto em uso, mostrando material e acabamento",
  "uso real no dia a dia, gesto natural",
  "o ambiente e o contexto, plano aberto",
  "close emocional (rosto e produto), olhar e expressão",
  "fechamento: produto em destaque com respiro para texto",
];

export const MIN_QUADROS = 3;
export const MAX_QUADROS = 6;

export const MODOS_DO_AMBIENTE = ["descrever", "foto", "contexto"] as const;
export const USOS_DA_FOTO_DO_AMBIENTE = ["usar", "complementar"] as const;

export const MAX_MENSAGENS_DO_AGENTE = 24;

/** Modelos prontos da tela (canvasApi.ts, MODELOS_PRONTOS): o agente só sugere um destes. */
export const CHAVES_DOS_MODELOS_PRONTOS = [
  "produto-na-mao",
  "produto-na-praia",
  "loja-da-marca",
  "ugc-selfie",
  "flat-lay",
  "vitrine",
  "carrossel-de-produto",
  "produto-no-ambiente",
  "modelo-na-rua",
];

/** Carrossel: 0 (foto solta) ou de 3 a 6. */
export const lerCarrossel = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= MIN_QUADROS ? Math.min(MAX_QUADROS, n) : 0;
};

/** Ângulo pedido (índice de ANGULOS_DE_VARIACAO) ou null. */
export const lerAngulo = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n % ANGULOS_DE_VARIACAO.length : null;
};

/** Posição no carrossel { atual, total } (atual de 1 a total) ou null. */
export function lerQuadro(quadro: unknown, quadros: unknown): { atual: number; total: number } | null {
  const total = lerCarrossel(quadros);
  const atual = Math.floor(Number(quadro));
  if (!total || !Number.isFinite(atual) || atual < 1) return null;
  return { atual: Math.min(atual, total), total };
}

/**
 * Ambiente "pelo contexto" sem IA: o lugar sai da marca (estilo e paleta), do
 * nicho e da campanha que a Mesa usa. Sem dado, um lugar neutro e real.
 */
export function ambienteDoContexto(ctx: { cliente?: string | null; estilo?: string | null; nicho?: string | null; campanha?: string | null } | null): string {
  const partes: string[] = [];
  if (ctx?.nicho) partes.push(`lugar típico de ${limpo(ctx.nicho, 120)}`);
  if (ctx?.estilo) partes.push(`com a cara da marca (${limpo(ctx.estilo, 240)})`);
  if (ctx?.campanha) partes.push(`no clima da campanha ${limpo(ctx.campanha, 120)}`);
  const base = partes.length ? partes.join(", ") : "lugar real e atual, com materiais naturais e luz natural";
  return semTravessao(`Ambiente pensado para ${limpo(ctx?.cliente, 120) || "a marca"}: ${base}. Cenário crível, sem texto nem marca de terceiros.`);
}

/**
 * Nomes que a tela usa para os mesmos cartões (o quadro chama o prompt de
 * "texto" e o resultado de "gerar"). Aceitos na entrada e gravados sempre com
 * o nome da função, para canvas salvo por qualquer lado continuar abrindo.
 */
export const APELIDOS_DE_TIPO: Record<string, TipoDeNo> = { texto: "prompt", gerar: "saida" };

/** Tipo do cartão com o apelido da tela já traduzido (desconhecido volta como veio). */
export const lerTipoDeNo = (v: unknown): string => {
  const t = String(v ?? "").trim();
  return APELIDOS_DE_TIPO[t] ?? t;
};

/**
 * Campos do pedido de montar e gerar, com os apelidos da tela:
 * no_gerar_id = no_saida_id e motor_id = modelo_imagem_id.
 */
export function lerPedidoDoCanvas(corpo: Record<string, unknown>): { no_saida_id: string | null; modelo_imagem_id: string } {
  const saida = String(corpo.no_saida_id ?? corpo.no_gerar_id ?? "").trim();
  return { no_saida_id: saida || null, modelo_imagem_id: limpo(corpo.modelo_imagem_id ?? corpo.motor_id, 160) };
}

export type NoCanvas = { id: string; tipo: TipoDeNo; x: number; y: number; dados: Record<string, unknown> };
export type LigacaoCanvas = { id: string; de: string; para: string; ordem: number };
export type Viewport = { x: number; y: number; zoom: number };
export type CanvasNormalizado = { nome: string; nos: NoCanvas[]; ligacoes: LigacaoCanvas[]; viewport: Viewport };

export const MAX_NOS = 60;
export const MAX_LIGACOES = 120;
/** Limite da casa de imagens de entrada no Canvas (o do gerador vale quando é menor). */
export const LIMITE_REFERENCIAS_DO_CANVAS = 12;

/** Papel de cada nó de entrada ao chegar no gerador. */
export type PapelNoCanvas = "produto" | "pessoa" | "ambiente" | "estilo";
export const PAPEL_DO_NO: Record<Exclude<TipoDeNo, "saida" | "prompt" | "agente">, PapelNoCanvas> = {
  produto: "produto",
  modelo: "pessoa",
  ambiente: "ambiente",
  estilo: "estilo",
};

const ID_DE_NO = /^[A-Za-z0-9_-]{1,64}$/;

const numeroFinito = (v: unknown, padrao = 0, min = -1e6, max = 1e6) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
};

const listaDeIds = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.map((x) => String(x ?? "").trim()).filter((x) => UUID.test(x)))).slice(0, max) : [];

const idOuNulo = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return UUID.test(s) ? s : null;
};

/** Um id (campo único) ou a lista (campo no plural), juntos e sem repetir. */
const idsDeUmOuVarios = (lista: unknown, um: unknown, max: number): string[] => {
  const ids = listaDeIds(lista, max);
  const unico = idOuNulo(um);
  return unico && !ids.includes(unico) ? [unico, ...ids].slice(0, max) : ids;
};

export const MAX_RESULTADOS_NA_SAIDA = 24;

/**
 * Resultados que a tela guarda na Saída (a geração vale em foto_canvas_geracoes;
 * aqui fica só o atalho para a Saída mostrar sem reler). URL assinada não entra
 * (expira): a tela assina pelo storage_path.
 */
export function resultadosDaSaida(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  const saida: Record<string, unknown>[] = [];
  for (const b of v) {
    const r = (b && typeof b === "object" && !Array.isArray(b) ? b : {}) as Record<string, unknown>;
    const geracao = limpo(r.geracao_id ?? r.id, 80);
    if (!geracao || saida.some((x) => x.geracao_id === geracao)) continue;
    const status = r.status === "falhou" || r.status === "gerando" ? r.status : "gerada";
    const custo = Number(r.custo_usd);
    const conferencia = r.conferencia && typeof r.conferencia === "object" && !Array.isArray(r.conferencia) && JSON.stringify(r.conferencia).length <= 6000 ? r.conferencia : null;
    const quadro = Math.floor(Number(r.quadro));
    // Série (variações de uma foto ou carrossel): o grupo junta as fotos na tela. Foto solta não leva estes campos.
    const grupo = /^[A-Za-z0-9_-]{1,64}$/.test(String(r.grupo ?? "")) ? String(r.grupo) : null;
    const serie = grupo
      ? { grupo, quadro: Number.isFinite(quadro) && quadro > 0 ? Math.min(quadro, 12) : null, tipo: r.tipo === "carrossel" ? "carrossel" : "variacao" }
      : {};
    saida.push({
      ...serie,
      geracao_id: geracao,
      imagem_id: idOuNulo(r.imagem_id),
      storage_bucket: limpo(r.storage_bucket, 60) || "mesa",
      storage_path: limpo(r.storage_path, 400),
      motor_id: limpo(r.motor_id ?? r.modelo_imagem_id, 160),
      status,
      erro: limpo(r.erro ?? r.ultimo_erro, 300),
      custo_usd: Number.isFinite(custo) && custo >= 0 ? custo : 0,
      conferencia,
      criado_em: limpo(r.criado_em, 40),
    });
  }
  return saida.slice(-MAX_RESULTADOS_NA_SAIDA);
}

/**
 * Dados de cada tipo de nó, só com os campos conhecidos. Aceita também a forma
 * da tela (estilo com imagem_id, biblioteca_id e texto no singular; ambiente
 * com a lista) e grava sempre a forma da função.
 */
export function dadosDoNo(tipo: TipoDeNo, bruto: unknown): Record<string, unknown> {
  const d = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const titulo = limpo(d.titulo, 120) || null;
  switch (tipo) {
    case "produto":
      return { titulo, kit_id: idOuNulo(d.kit_id), imagem_ids: idsDeUmOuVarios(d.imagem_ids, d.imagem_id, 8) };
    case "modelo": {
      // Pessoa: persona sintética (modelo_id) ou foto real do acervo (imagem_id, só com autorização).
      const versao = Math.floor(Number(d.versao));
      const modeloId = idOuNulo(d.modelo_id);
      return {
        titulo,
        modelo_id: modeloId,
        versao: Number.isFinite(versao) && versao > 0 ? versao : null,
        imagem_id: modeloId ? null : idOuNulo(d.imagem_id),
        autorizada: !modeloId && d.autorizada === true,
      };
    }
    case "ambiente": {
      const texto = limpo(d.texto ?? d.guia, 1500) || null;
      if (texto) garantirPermitido(texto);
      const imagem = idOuNulo(d.imagem_id) ?? listaDeIds(d.imagem_ids, 1)[0] ?? null;
      const modo = (MODOS_DO_AMBIENTE as readonly string[]).includes(String(d.modo)) ? String(d.modo) : imagem ? "foto" : "descrever";
      return {
        titulo,
        imagem_id: imagem,
        biblioteca_id: idOuNulo(d.biblioteca_id) ?? listaDeIds(d.biblioteca_ids, 1)[0] ?? null,
        texto,
        modo,
        uso: d.uso === "usar" ? "usar" : "complementar",
      };
    }
    case "estilo": {
      const guia = limpo(d.guia ?? d.texto, 1500) || null;
      if (guia) garantirPermitido(guia);
      return { titulo, imagem_ids: idsDeUmOuVarios(d.imagem_ids, d.imagem_id, 6), biblioteca_ids: idsDeUmOuVarios(d.biblioteca_ids, d.biblioteca_id, 6), guia };
    }
    case "prompt": {
      const texto = limpo(d.texto, 3000);
      if (texto) garantirPermitido(texto);
      return { titulo, texto, papel: d.papel === "restricao" ? "restricao" : "pedido" };
    }
    case "saida": {
      const formato = (FORMATOS as readonly string[]).includes(String(d.formato)) ? String(d.formato) : "4:5";
      const qualidade = ["baixa", "media", "alta"].includes(String(d.qualidade)) ? String(d.qualidade) : "alta";
      const resolucao = ["512", "1K", "2K", "4K"].includes(String(d.resolucao ?? "").toUpperCase()) ? String(d.resolucao).toUpperCase() : null;
      const motores = Array.isArray(d.motores) ? Array.from(new Set(d.motores.map((x) => limpo(x, 120)).filter(Boolean))).slice(0, 8) : [];
      const acao = String(d.acao ?? "") in ACOES_DO_RESULTADO ? String(d.acao) : "livre";
      const pose = String(d.pose ?? "") in POSES_DO_RESULTADO ? String(d.pose) : "nenhuma";
      return { titulo, formato, qualidade, resolucao, motores, acao, pose, carrossel: lerCarrossel(d.carrossel), resultados: resultadosDaSaida(d.resultados) };
    }
    case "agente": {
      // A conversa fica no cartão (curta); o pedido que o agente escreveu vai ao gerador.
      const pedido = limpo(d.pedido, 3000);
      if (pedido) garantirPermitido(pedido);
      const mensagens = (Array.isArray(d.mensagens) ? d.mensagens : [])
        .map((m) => {
          const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
          return { papel: o.papel === "agente" ? "agente" : "usuario", texto: limpo(o.texto, 2000) };
        })
        .filter((m) => m.texto)
        .slice(-MAX_MENSAGENS_DO_AGENTE);
      return { titulo, pedido, mensagens };
    }
  }
}

/**
 * Canvas vindo da tela, validado: ids de nó únicos, tipos conhecidos, posição
 * numérica, ligações só entre nós existentes, sem laço, sempre de um nó de
 * entrada para um nó saida, sem ligação repetida. Nada de id de banco aqui:
 * a função confere kits, personas e imagens contra o banco antes de gravar.
 * Aceita os nomes da tela (texto, gerar; ligação com entrada) e devolve a
 * forma da função (prompt, saida; ligação { id, de, para, ordem }).
 */
export function normalizarCanvas(bruto: unknown): CanvasNormalizado {
  const r = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const nome = limpo(r.nome, 120) || "Canvas";
  const nosBrutos = Array.isArray(r.nos) ? r.nos : [];
  if (nosBrutos.length > MAX_NOS) throw new ErroDeRegra(400, "nos_demais", `O canvas aceita no máximo ${MAX_NOS} cartões.`);
  const nos: NoCanvas[] = [];
  const ids = new Set<string>();
  for (const b of nosBrutos) {
    const n = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    const id = String(n.id ?? "").trim();
    const tipo = lerTipoDeNo(n.tipo) as TipoDeNo;
    if (!ID_DE_NO.test(id)) throw new ErroDeRegra(400, "no_invalido", "Todo cartão precisa de um id (letras, números, _ ou -).", { no: id.slice(0, 64) });
    if (ids.has(id)) throw new ErroDeRegra(400, "no_repetido", "Há dois cartões com o mesmo id.", { no: id });
    if (!(TIPOS_DE_NO as readonly string[]).includes(tipo)) throw new ErroDeRegra(400, "tipo_de_no_invalido", `Tipo de cartão desconhecido. Use: ${TIPOS_DE_NO.join(", ")}.`, { no: id });
    ids.add(id);
    const pos = (n.position && typeof n.position === "object" ? n.position : n) as Record<string, unknown>;
    nos.push({ id, tipo, x: numeroFinito(pos.x), y: numeroFinito(pos.y), dados: dadosDoNo(tipo, n.dados ?? n.data) });
  }
  const ligBrutas = Array.isArray(r.ligacoes) ? r.ligacoes : [];
  if (ligBrutas.length > MAX_LIGACOES) throw new ErroDeRegra(400, "ligacoes_demais", `O canvas aceita no máximo ${MAX_LIGACOES} ligações.`);
  const porId = new Map(nos.map((n) => [n.id, n]));
  const ligacoes: LigacaoCanvas[] = [];
  const vistas = new Set<string>();
  ligBrutas.forEach((b, i) => {
    const l = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    const de = String(l.de ?? l.source ?? "").trim();
    const para = String(l.para ?? l.target ?? "").trim();
    const origem = porId.get(de);
    const destino = porId.get(para);
    if (!origem || !destino) throw new ErroDeRegra(400, "ligacao_invalida", "Ligação com cartão que não existe no canvas.", { de, para });
    if (de === para) throw new ErroDeRegra(400, "ligacao_invalida", "Um cartão não se liga a ele mesmo.", { de });
    if (destino.tipo !== "saida") throw new ErroDeRegra(400, "ligacao_invalida", "As ligações vão sempre para um cartão de resultado.", { de, para });
    if (origem.tipo === "saida") throw new ErroDeRegra(400, "ligacao_invalida", "Um resultado não alimenta outro resultado.", { de, para });
    const chave = `${de}>${para}`;
    if (vistas.has(chave)) return;
    vistas.add(chave);
    const id = ID_DE_NO.test(String(l.id ?? "")) ? String(l.id) : `l_${de}_${para}`.slice(0, 64);
    ligacoes.push({ id, de, para, ordem: Math.round(numeroFinito(l.ordem, i, 0, 10_000)) });
  });
  const v = (r.viewport && typeof r.viewport === "object" ? r.viewport : {}) as Record<string, unknown>;
  return { nome, nos, ligacoes, viewport: { x: numeroFinito(v.x), y: numeroFinito(v.y), zoom: numeroFinito(v.zoom, 1, 0.05, 8) } };
}

/**
 * Canvas lido do banco na forma da função, mesmo se foi gravado com os nomes
 * da tela. Sem recusar: o que não valida fica como estava, só com o tipo
 * traduzido (a validação completa é no salvar).
 */
export function canvasGravado(linha: { nome?: unknown; nos?: unknown; ligacoes?: unknown; viewport?: unknown }): Pick<CanvasNormalizado, "nos" | "ligacoes"> {
  const nos = Array.isArray(linha.nos) ? linha.nos : [];
  const ligacoes = Array.isArray(linha.ligacoes) ? linha.ligacoes : [];
  try {
    const c = normalizarCanvas({ nome: linha.nome, nos, ligacoes, viewport: linha.viewport });
    return { nos: c.nos, ligacoes: c.ligacoes };
  } catch {
    return {
      nos: nos.map((b) => {
        const n = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
        return { ...(n as unknown as NoCanvas), tipo: lerTipoDeNo(n.tipo) as TipoDeNo };
      }),
      ligacoes: ligacoes as LigacaoCanvas[],
    };
  }
}

/** Ids de banco que o canvas cita (para a função conferir contra o banco). */
export function idsDoCanvas(c: Pick<CanvasNormalizado, "nos">) {
  const kits = new Set<string>();
  const modelos = new Set<string>();
  const imagens = new Set<string>();
  const biblioteca = new Set<string>();
  for (const n of c.nos) {
    const d = n.dados;
    if (n.tipo === "produto" && d.kit_id) kits.add(String(d.kit_id));
    if (n.tipo === "produto") (d.imagem_ids as string[] ?? []).forEach((x) => imagens.add(x));
    if (n.tipo === "modelo" && d.modelo_id) modelos.add(String(d.modelo_id));
    if (n.tipo === "modelo" && !d.modelo_id && d.imagem_id) imagens.add(String(d.imagem_id));
    if (n.tipo === "ambiente" && d.imagem_id) imagens.add(String(d.imagem_id));
    if (n.tipo === "ambiente" && d.biblioteca_id) biblioteca.add(String(d.biblioteca_id));
    if (n.tipo === "estilo") {
      (d.imagem_ids as string[] ?? []).forEach((x) => imagens.add(x));
      (d.biblioteca_ids as string[] ?? []).forEach((x) => biblioteca.add(x));
    }
  }
  return { kits: [...kits], modelos: [...modelos], imagens: [...imagens], biblioteca: [...biblioteca] };
}

/** O nó saida a gerar: o pedido, ou o único do canvas. */
export function escolherSaida(c: Pick<CanvasNormalizado, "nos">, pedido?: unknown): NoCanvas {
  const saidas = c.nos.filter((n) => n.tipo === "saida");
  if (pedido != null && String(pedido).trim()) {
    const s = saidas.find((n) => n.id === String(pedido).trim());
    if (!s) throw new ErroDeRegra(404, "saida_inexistente", "Este cartão de resultado não existe no canvas.", { no_saida_id: String(pedido).slice(0, 64) });
    return s;
  }
  if (saidas.length === 1) return saidas[0];
  if (!saidas.length) throw new ErroDeRegra(409, "sem_saida", "Ponha um cartão de resultado no canvas e ligue as entradas nele.");
  throw new ErroDeRegra(400, "saida_obrigatoria", "O canvas tem mais de um cartão de resultado: diga qual gerar (no_saida_id).", { saidas: saidas.map((s) => s.id) });
}

export type EntradasDaSaida = { produto: NoCanvas[]; modelo: NoCanvas[]; ambiente: NoCanvas[]; estilo: NoCanvas[]; prompt: NoCanvas[]; agente?: NoCanvas[] };

/** Nós ligados ao resultado, agrupados por tipo, na ordem das ligações. */
export function entradasDaSaida(c: Pick<CanvasNormalizado, "nos" | "ligacoes">, saidaId: string): EntradasDaSaida {
  const porId = new Map(c.nos.map((n) => [n.id, n]));
  const ligadas = c.ligacoes.filter((l) => l.para === saidaId).sort((a, b) => a.ordem - b.ordem);
  const e: Required<EntradasDaSaida> = { produto: [], modelo: [], ambiente: [], estilo: [], prompt: [], agente: [] };
  for (const l of ligadas) {
    const n = porId.get(l.de);
    if (!n || n.tipo === "saida") continue;
    if (!e[n.tipo].some((x) => x.id === n.id)) e[n.tipo].push(n);
  }
  return e;
}

/**
 * Ordem de distribuição das vagas entre os papéis. Com 8 vagas: produto 3,
 * pessoa 3, ambiente 1, estilo 1. Com 16: 5, 5, 2, 4. Com 3: 1, 1, 1.
 * Depois de 16, o ciclo produto, pessoa, estilo, ambiente se repete.
 */
export const SEQUENCIA_DO_ORCAMENTO: PapelNoCanvas[] = [
  "produto", "pessoa", "ambiente", "estilo", "produto", "pessoa", "produto", "pessoa",
  "estilo", "produto", "pessoa", "estilo", "ambiente", "produto", "pessoa", "estilo",
];
const CICLO_DEPOIS: PapelNoCanvas[] = ["produto", "pessoa", "estilo", "ambiente"];

/**
 * Vagas por papel dentro do limite. Papel sem imagem disponível passa a vaga
 * adiante (ninguém perde vaga à toa).
 */
export function orcamentoPorPapel(limite: number, disponiveis: Record<PapelNoCanvas, number>): Record<PapelNoCanvas, number> {
  const saida: Record<PapelNoCanvas, number> = { produto: 0, pessoa: 0, ambiente: 0, estilo: 0 };
  const total = Object.values(disponiveis).reduce((s, v) => s + Math.max(0, v), 0);
  let vagas = Math.min(Math.max(0, Math.floor(limite)), total);
  let i = 0;
  while (vagas > 0 && i < 10_000) {
    const papel = i < SEQUENCIA_DO_ORCAMENTO.length ? SEQUENCIA_DO_ORCAMENTO[i] : CICLO_DEPOIS[(i - SEQUENCIA_DO_ORCAMENTO.length) % CICLO_DEPOIS.length];
    i++;
    if (saida[papel] < Math.max(0, disponiveis[papel])) {
      saida[papel]++;
      vagas--;
    }
  }
  return saida;
}

export type OrigemDaReferencia = { tipo: "kit" | "persona" | "acervo" | "biblioteca"; id: string; no_id: string };
export type ReferenciaCandidata = {
  /** "base": a foto base de uma variação ou do carrossel (vai sempre em 1º, fora do orçamento por papel). */
  papel: PapelNoCanvas | "base";
  origem: OrigemDaReferencia;
  /** cliente_imagens (kit, acervo), foto_modelo_imagens (persona) ou foto_biblioteca. */
  imagem_id: string;
  titulo: string;
  legenda: string;
};
export type ReferenciaMontada = ReferenciaCandidata & { ordem: number };

/**
 * Referências em ordem de papel (produto, pessoa, ambiente, estilo), dentro
 * do orçamento. O que ficou de fora volta em `cortadas` com aviso.
 */
export function ordenarReferencias(candidatas: ReferenciaCandidata[], limite: number): { referencias: ReferenciaMontada[]; cortadas: ReferenciaCandidata[]; avisos: string[] } {
  const ordemDosPapeis: PapelNoCanvas[] = ["produto", "pessoa", "ambiente", "estilo"];
  const porPapel = Object.fromEntries(ordemDosPapeis.map((p) => [p, candidatas.filter((c) => c.papel === p)])) as Record<PapelNoCanvas, ReferenciaCandidata[]>;
  const vagas = orcamentoPorPapel(limite, {
    produto: porPapel.produto.length,
    pessoa: porPapel.pessoa.length,
    ambiente: porPapel.ambiente.length,
    estilo: porPapel.estilo.length,
  });
  const escolhidas: ReferenciaCandidata[] = [];
  const cortadas: ReferenciaCandidata[] = [];
  for (const p of ordemDosPapeis) {
    escolhidas.push(...porPapel[p].slice(0, vagas[p]));
    cortadas.push(...porPapel[p].slice(vagas[p]));
  }
  const avisos: string[] = [];
  if (cortadas.length) avisos.push(`${cortadas.length} ${cortadas.length === 1 ? "imagem ficou" : "imagens ficaram"} de fora pelo limite de ${Math.floor(limite)} referências deste gerador.`);
  for (const p of ordemDosPapeis) {
    if (porPapel[p].length && !vagas[p]) avisos.push(`Nenhuma imagem de ${p} coube no limite do gerador: ${p} vai só pelo texto.`);
  }
  return { referencias: escolhidas.map((r, i) => ({ ...r, ordem: i + 1 })), cortadas, avisos };
}

/**
 * Com foto base (variação ou carrossel): ela vai como Imagem 1 e as outras
 * dividem o que sobra do limite (limite - 1), na mesma ordem de papel.
 */
export function ordenarComBase(base: ReferenciaCandidata | null, candidatas: ReferenciaCandidata[], limite: number) {
  if (!base) return ordenarReferencias(candidatas, limite);
  const resto = ordenarReferencias(candidatas.filter((c) => c.papel !== "base"), Math.max(0, limite - 1));
  return {
    ...resto,
    referencias: [{ ...base, papel: "base" as const, ordem: 1 }, ...resto.referencias.map((r) => ({ ...r, ordem: r.ordem + 1 }))],
  };
}

/** Faixa "Imagem 1" ou "Imagens 2 a 4" das referências de um papel. */
function faixa(refs: ReferenciaMontada[]): string {
  if (!refs.length) return "";
  const a = refs[0].ordem;
  const b = refs[refs.length - 1].ordem;
  return a === b ? `Imagem ${a}` : `Imagens ${a} a ${b}`;
}

export type ProdutoDoPedido = { no_id: string; nome: string; variante: string | null; invariantes: string[]; lacunas: string[] };
export type PessoaDoPedido = { no_id: string; nome: string; ficha: FichaDaPersona; invariantes: string[] };
/** Pessoa real (foto do acervo do cliente, com autorização registrada no cartão). */
export type PessoaRealDoPedido = { no_id: string; nome: string };

/**
 * Prompt do Canvas com índice das imagens por papel, as invariantes do kit e
 * da ficha repetidas, o ambiente e o estilo só como direção, o texto livre e
 * o bloco de hiper-realismo quando há pessoa. Na v3 entram a ação da
 * composição, a pose (UGC troca a lente de retrato pela de celular), a foto
 * base da série, o ângulo obrigatório e a posição no carrossel.
 */
export function promptDoCanvas(e: {
  referencias: ReferenciaMontada[];
  produtos: ProdutoDoPedido[];
  pessoas: PessoaDoPedido[];
  pessoasReais?: PessoaRealDoPedido[];
  ambientes: { texto: string | null; no_id?: string; modo?: string; uso?: string; comFoto?: boolean }[];
  estilos: { guia: string | null }[];
  textos: { texto: string; papel: "pedido" | "restricao" }[];
  formato: Formato;
  marca?: { nome: string; paleta: string[] } | null;
  acao?: string | null;
  pose?: string | null;
  angulo?: number | null;
  quadro?: { atual: number; total: number } | null;
}): string {
  const linhas: string[] = [];
  const reais = e.pessoasReais ?? [];
  const temPessoa = e.pessoas.length > 0 || reais.length > 0;
  const ugc = !!e.pose && POSES_UGC.includes(e.pose);
  const tipoDaFoto = ugc ? "UGC REAL FEITA COM CELULAR" : temPessoa ? "PUBLICITÁRIA EDITORIAL REAL" : "PUBLICITÁRIA DE PRODUTO REAL";
  linhas.push(`FOTOGRAFIA ${tipoDaFoto}${e.marca?.nome ? ` para a marca ${e.marca.nome}` : ""}, formato ${e.formato}.`);
  const pedidos = e.textos.filter((t) => t.papel === "pedido" && t.texto);
  if (pedidos.length) linhas.push(`PEDIDO: ${pedidos.map((t) => t.texto).join(" ")}`);

  const refsDe = (papel: PapelNoCanvas | "base") => e.referencias.filter((r) => r.papel === papel);
  if (e.referencias.length) linhas.push("IMAGENS ANEXADAS, NA ORDEM:");
  const base = refsDe("base");
  if (base.length) {
    linhas.push(`${faixa(base)}: A FOTO BASE desta série (identidade da cena): a mesma pessoa (rosto, cabelo, pele e corpo), o mesmo produto, a mesma roupa, o mesmo lugar, a mesma luz e a mesma paleta. Não copie o enquadramento nem a pose da base: mude como pedido abaixo.`);
  }
  for (const p of e.produtos) {
    const refs = refsDe("produto").filter((r) => r.origem.no_id === p.no_id);
    const nome = `${p.nome}${p.variante ? ` (variante ${p.variante})` : ""}`;
    linhas.push(`${refs.length ? `${faixa(refs)}: ` : ""}O PRODUTO "${nome}" (identidade invariante): não mude formato, silhueta, proporções, cor, acabamento, logotipo nem texto; mesma quantidade de peças; escala real.${p.invariantes.length ? ` Invariantes: ${p.invariantes.join("; ")}.` : ""}`);
  }
  for (const pessoa of e.pessoas) {
    const refs = refsDe("pessoa").filter((r) => r.origem.no_id === pessoa.no_id);
    linhas.push(`${refs.length ? `${faixa(refs)}: ` : ""}A PESSOA SINTÉTICA "${pessoa.nome}" (identidade da pessoa, gerada, não existe): a mesma pessoa, com mesmo rosto, formato do rosto, olhos, nariz, lábios, tom de pele, marcas e cabelo. ${fichaEmTexto(pessoa.ficha)} Invariantes: ${pessoa.invariantes.join("; ")}.`);
  }
  for (const pessoa of reais) {
    const refs = refsDe("pessoa").filter((r) => r.origem.no_id === pessoa.no_id);
    linhas.push(`${refs.length ? `${faixa(refs)}: ` : ""}A PESSOA DA FOTO${pessoa.nome ? ` "${pessoa.nome}"` : ""} (pessoa real, com autorização registrada pela equipe): a mesma pessoa, com o mesmo rosto, formato do rosto, olhos, nariz, lábios, tom de pele e cabelo; não embeleze nem mude traços.`);
  }
  const ambientes = refsDe("ambiente");
  e.ambientes.forEach((a, i) => {
    const ref = a.no_id ? ambientes.find((r) => r.origem.no_id === a.no_id) : ambientes[i];
    const texto = a.texto ? ` (${a.texto})` : "";
    if (ref && a.uso === "usar") {
      linhas.push(`${faixa([ref])}: O LUGAR REAL: use este ambiente como o cenário da foto (mesma arquitetura, móveis, cores e luz do lugar)${texto}, com a cena ambientada e realista; não copie pessoas, marcas nem textos da foto.`);
    } else if (ref) {
      linhas.push(`${faixa([ref])}: O AMBIENTE (base): parta deste lugar e complemente o que faltar (estenda o espaço, arrume a cena, objetos de cena coerentes), mantendo a identidade do lugar${texto}; não copie pessoas, marcas nem textos da foto.`);
    } else {
      linhas.push(`O AMBIENTE: use o lugar, a luz e o clima${texto}; cenário crível e ambientado.`);
    }
  });
  const estilos = refsDe("estilo");
  if (estilos.length) linhas.push(`${faixa(estilos)}: SÓ ESTILO (paleta, luz, enquadramento e clima); não copie objetos, pessoas, marcas nem textos destas imagens.`);
  const guias = e.estilos.map((s) => s.guia).filter((g): g is string => !!g);
  if (guias.length) linhas.push(`DIREÇÃO DE ESTILO: ${guias.join(" ")} Esta direção não muda as invariantes.`);
  const acao = e.acao ? ACOES_DO_RESULTADO[e.acao] ?? "" : "";
  const pose = e.pose ? POSES_DO_RESULTADO[e.pose] ?? "" : "";
  if (acao) linhas.push(`COMPOSIÇÃO: ${acao}`);
  if (pose) linhas.push(pose);
  if (e.quadro) {
    const papel = QUADROS_DO_CARROSSEL[Math.min(e.quadro.atual, QUADROS_DO_CARROSSEL.length) - 1];
    linhas.push(`CARROSSEL: esta é a foto ${e.quadro.atual} de ${e.quadro.total} de uma sequência coerente (mesma pessoa, mesmo produto, mesmo ambiente, mesma paleta e mesma luz). Esta foto: ${papel}.`);
  }
  if (e.angulo !== null && e.angulo !== undefined) {
    linhas.push(`ÂNGULO DESTA VERSÃO (obrigatório): ${ANGULOS_DE_VARIACAO[e.angulo % ANGULOS_DE_VARIACAO.length]}. Tem que ser diferente das outras fotos da série; nada de repetir o enquadramento.`);
  }
  if (temPessoa) {
    if (!acao && !pose) linhas.push("AÇÃO: a pessoa usa o produto do jeito real de uso, com naturalidade; o produto na escala e na posição certas de uso; mãos com cinco dedos.");
    // UGC: pele real igual, mas lente e luz de celular no lugar do retrato de 85 mm.
    if (ugc) linhas.push(BLOCO_HIPER_REALISMO[0], LENTE_UGC, BLOCO_HIPER_REALISMO[3]);
    else linhas.push(...BLOCO_HIPER_REALISMO);
    const regras = e.pessoas.length
      ? PROIBICOES_DA_PERSONA
      : ["pessoa real adulta, a mesma da foto, sem mudar traços", "sem sexualização, sem nudez e sem roupa reveladora", "mãos com cinco dedos, unhas e articulações corretas"];
    linhas.push(`REGRAS DA PESSOA: ${regras.join("; ")}.`);
  } else {
    linhas.push(ugc ? LENTE_UGC : "LUZ E CENA: luz com direção e fonte reais, sombra de contato e reflexos coerentes com o cenário; materiais críveis; profundidade real.");
  }
  const lacunas = e.produtos.flatMap((p) => p.lacunas).slice(0, 8);
  if (lacunas.length) linhas.push(`NÃO DOCUMENTADO NO KIT (não invente; deixe fora do quadro ou discreto): ${lacunas.join("; ")}.`);
  const restricoes = e.textos.filter((t) => t.papel === "restricao" && t.texto);
  if (restricoes.length) linhas.push(`RESTRIÇÕES DA EQUIPE: ${restricoes.map((t) => t.texto).join(" ")}`);
  if (e.marca?.paleta?.length) linhas.push(`MARCA: paleta de apoio ${e.marca.paleta.join(", ")} no cenário e nos objetos de cena, nunca no produto.`);
  linhas.push("PROIBIDO: texto inventado, marca d'água, logotipo de terceiros, produto duplicado ou deformado, ilustração ou 3D, escurecer a foto para dar destaque.");
  return semTravessao(linhas.join("\n"));
}

/** Bloqueios do Canvas (regra fixa): sem produto e sem pessoa não gera. */
export function garantirQueDaParaGerar(e: EntradasDaSaida): void {
  if (!e.produto.length && !e.modelo.length) {
    throw new ErroDeRegra(409, "sem_produto_nem_pessoa", "Ligue ao resultado pelo menos um produto (kit) ou uma modelo (persona).");
  }
  for (const n of e.produto) if (!n.dados.kit_id) throw new ErroDeRegra(409, "produto_sem_kit", "Há cartão de produto sem kit escolhido.", { no_id: n.id });
  for (const n of e.modelo) {
    if (!n.dados.modelo_id && !n.dados.imagem_id) throw new ErroDeRegra(409, "modelo_sem_persona", "Há cartão de pessoa sem a modelo ou a foto escolhida.", { no_id: n.id });
    if (!n.dados.modelo_id && n.dados.imagem_id && n.dados.autorizada !== true) {
      throw new ErroDeRegra(409, "pessoa_sem_autorizacao", "Foto de pessoa real só entra com a autorização marcada no cartão.", { no_id: n.id });
    }
  }
}

/** Textos dos cartões de prompt ligados ao resultado, e o pedido que o agente escreveu. */
export function textosDasEntradas(e: EntradasDaSaida): { texto: string; papel: "pedido" | "restricao" }[] {
  const doAgente = (e.agente ?? []).map((n) => ({ texto: limpo(n.dados.pedido, 3000), papel: "pedido" as const }));
  return e.prompt
    .map((n) => ({ texto: limpo(n.dados.texto, 3000), papel: (n.dados.papel === "restricao" ? "restricao" : "pedido") as "pedido" | "restricao" }))
    .concat(doAgente)
    .filter((t) => t.texto);
}

/** Histórico que a tela manda para o agente (curto, só texto). */
export function historicoDoAgente(v: unknown): { papel: "usuario" | "agente"; conteudo: string }[] {
  return (Array.isArray(v) ? v : [])
    .map((m) => {
      const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
      return { papel: (o.papel === "agente" ? "agente" : "usuario") as "usuario" | "agente", conteudo: limpo(o.texto ?? o.conteudo, 2000) };
    })
    .filter((m) => m.conteudo)
    .slice(-12);
}

/**
 * Resposta do agente do Canvas, validada: a ação, a pose, o formato, o modelo
 * pronto e os ids sugeridos só valem se estão nas listas que a função mandou.
 */
export function respostaDoAgente(
  bruto: unknown,
  validos: { kits: string[]; modelos: string[]; modelosProntos: string[]; formatos: string[] },
): { resposta: string; pedido: string; acao: string | null; pose: string | null; ambiente: string | null; formato: string | null; modelo_pronto: string | null; kit_id: string | null; modelo_id: string | null } {
  const r = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const dentro = (v: unknown, lista: string[]) => (typeof v === "string" && lista.includes(v) ? v : null);
  const pedido = limpo(r.pedido, 3000);
  let pedidoOk = pedido;
  try {
    if (pedido) garantirPermitido(pedido);
  } catch {
    pedidoOk = "";
  }
  return {
    resposta: semTravessao(limpo(r.resposta, 4000)) || "Sem resposta do agente.",
    pedido: semTravessao(pedidoOk),
    acao: dentro(r.acao, Object.keys(ACOES_DO_RESULTADO)),
    pose: dentro(r.pose, Object.keys(POSES_DO_RESULTADO)),
    ambiente: semTravessao(limpo(r.ambiente, 1500)) || null,
    formato: dentro(r.formato, validos.formatos),
    modelo_pronto: dentro(r.modelo_pronto, validos.modelosProntos),
    kit_id: dentro(r.kit_id, validos.kits),
    modelo_id: dentro(r.modelo_id, validos.modelos),
  };
}

export const listaCurta = (v: unknown) => listaDeTextos(v, 12, 200);
