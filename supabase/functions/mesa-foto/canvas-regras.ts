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
 */

import { ErroDeRegra, limpo, listaDeTextos, semTravessao, UUID } from "./calculos.ts";
import { FORMATOS, type Formato } from "./receitas.ts";
import { BLOCO_HIPER_REALISMO, type FichaDaPersona, fichaEmTexto, garantirPermitido, PROIBICOES_DA_PERSONA } from "./personas.ts";

export const TIPOS_DE_NO = ["produto", "modelo", "ambiente", "estilo", "prompt", "saida"] as const;
export type TipoDeNo = typeof TIPOS_DE_NO[number];

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
export const PAPEL_DO_NO: Record<Exclude<TipoDeNo, "saida" | "prompt">, PapelNoCanvas> = {
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
    saida.push({
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
      const versao = Math.floor(Number(d.versao));
      return { titulo, modelo_id: idOuNulo(d.modelo_id), versao: Number.isFinite(versao) && versao > 0 ? versao : null };
    }
    case "ambiente": {
      const texto = limpo(d.texto ?? d.guia, 1500) || null;
      if (texto) garantirPermitido(texto);
      return {
        titulo,
        imagem_id: idOuNulo(d.imagem_id) ?? listaDeIds(d.imagem_ids, 1)[0] ?? null,
        biblioteca_id: idOuNulo(d.biblioteca_id) ?? listaDeIds(d.biblioteca_ids, 1)[0] ?? null,
        texto,
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
      return { titulo, formato, qualidade, resolucao, motores, resultados: resultadosDaSaida(d.resultados) };
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
    if (destino.tipo !== "saida") throw new ErroDeRegra(400, "ligacao_invalida", "As ligações vão sempre para um cartão de resultado (saida).", { de, para });
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
  if (!saidas.length) throw new ErroDeRegra(409, "sem_saida", "Ponha um cartão de resultado (saida) no canvas e ligue as entradas nele.");
  throw new ErroDeRegra(400, "saida_obrigatoria", "O canvas tem mais de um resultado: diga qual gerar (no_saida_id).", { saidas: saidas.map((s) => s.id) });
}

export type EntradasDaSaida = { produto: NoCanvas[]; modelo: NoCanvas[]; ambiente: NoCanvas[]; estilo: NoCanvas[]; prompt: NoCanvas[] };

/** Nós ligados ao resultado, agrupados por tipo, na ordem das ligações. */
export function entradasDaSaida(c: Pick<CanvasNormalizado, "nos" | "ligacoes">, saidaId: string): EntradasDaSaida {
  const porId = new Map(c.nos.map((n) => [n.id, n]));
  const ligadas = c.ligacoes.filter((l) => l.para === saidaId).sort((a, b) => a.ordem - b.ordem);
  const e: EntradasDaSaida = { produto: [], modelo: [], ambiente: [], estilo: [], prompt: [] };
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
  papel: PapelNoCanvas;
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

/** Faixa "Imagem 1" ou "Imagens 2 a 4" das referências de um papel. */
function faixa(refs: ReferenciaMontada[]): string {
  if (!refs.length) return "";
  const a = refs[0].ordem;
  const b = refs[refs.length - 1].ordem;
  return a === b ? `Imagem ${a}` : `Imagens ${a} a ${b}`;
}

export type ProdutoDoPedido = { no_id: string; nome: string; variante: string | null; invariantes: string[]; lacunas: string[] };
export type PessoaDoPedido = { no_id: string; nome: string; ficha: FichaDaPersona; invariantes: string[] };

/**
 * Prompt do Canvas com índice das imagens por papel, as invariantes do kit e
 * da ficha repetidas, o ambiente e o estilo só como direção, o texto livre e
 * o bloco de hiper-realismo quando há pessoa.
 */
export function promptDoCanvas(e: {
  referencias: ReferenciaMontada[];
  produtos: ProdutoDoPedido[];
  pessoas: PessoaDoPedido[];
  ambientes: { texto: string | null }[];
  estilos: { guia: string | null }[];
  textos: { texto: string; papel: "pedido" | "restricao" }[];
  formato: Formato;
  marca?: { nome: string; paleta: string[] } | null;
}): string {
  const linhas: string[] = [];
  const temPessoa = e.pessoas.length > 0;
  linhas.push(`FOTOGRAFIA ${temPessoa ? "PUBLICITÁRIA EDITORIAL REAL" : "PUBLICITÁRIA DE PRODUTO REAL"}${e.marca?.nome ? ` para a marca ${e.marca.nome}` : ""}, formato ${e.formato}.`);
  const pedidos = e.textos.filter((t) => t.papel === "pedido" && t.texto);
  if (pedidos.length) linhas.push(`PEDIDO: ${pedidos.map((t) => t.texto).join(" ")}`);

  const refsDe = (papel: PapelNoCanvas) => e.referencias.filter((r) => r.papel === papel);
  if (e.referencias.length) linhas.push("IMAGENS ANEXADAS, NA ORDEM:");
  for (const p of e.produtos) {
    const refs = refsDe("produto").filter((r) => r.origem.no_id === p.no_id);
    const nome = `${p.nome}${p.variante ? ` (variante ${p.variante})` : ""}`;
    linhas.push(`${refs.length ? `${faixa(refs)}: ` : ""}O PRODUTO "${nome}" (identidade invariante): não mude formato, silhueta, proporções, cor, acabamento, logotipo nem texto; mesma quantidade de peças; escala real.${p.invariantes.length ? ` Invariantes: ${p.invariantes.join("; ")}.` : ""}`);
  }
  for (const pessoa of e.pessoas) {
    const refs = refsDe("pessoa").filter((r) => r.origem.no_id === pessoa.no_id);
    linhas.push(`${refs.length ? `${faixa(refs)}: ` : ""}A PESSOA SINTÉTICA "${pessoa.nome}" (identidade da pessoa, gerada, não existe): a mesma pessoa, com mesmo rosto, formato do rosto, olhos, nariz, lábios, tom de pele, marcas e cabelo. ${fichaEmTexto(pessoa.ficha)} Invariantes: ${pessoa.invariantes.join("; ")}.`);
  }
  const ambientes = refsDe("ambiente");
  e.ambientes.forEach((a, i) => {
    const ref = ambientes[i];
    linhas.push(`${ref ? `${faixa([ref])}: ` : ""}O AMBIENTE: use o lugar, a luz e o clima${a.texto ? ` (${a.texto})` : ""}; não copie pessoas, marcas nem textos da foto do ambiente.`);
  });
  const estilos = refsDe("estilo");
  if (estilos.length) linhas.push(`${faixa(estilos)}: SÓ ESTILO (paleta, luz, enquadramento e clima); não copie objetos, pessoas, marcas nem textos destas imagens.`);
  const guias = e.estilos.map((s) => s.guia).filter((g): g is string => !!g);
  if (guias.length) linhas.push(`DIREÇÃO DE ESTILO: ${guias.join(" ")} Esta direção não muda as invariantes.`);
  if (temPessoa) {
    linhas.push("AÇÃO: a pessoa usa o produto do jeito real de uso, com naturalidade; o produto na escala e na posição certas de uso; mãos com cinco dedos.");
    linhas.push(...BLOCO_HIPER_REALISMO);
    linhas.push(`REGRAS DA PESSOA: ${PROIBICOES_DA_PERSONA.join("; ")}.`);
  } else {
    linhas.push("LUZ E CENA: luz com direção e fonte reais, sombra de contato e reflexos coerentes com o cenário; materiais críveis; profundidade real.");
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
    throw new ErroDeRegra(409, "sem_produto_nem_pessoa", "Ligue ao resultado pelo menos um produto (kit) ou uma persona.");
  }
  for (const n of e.produto) if (!n.dados.kit_id) throw new ErroDeRegra(409, "produto_sem_kit", "Há cartão de produto sem kit escolhido.", { no_id: n.id });
  for (const n of e.modelo) if (!n.dados.modelo_id) throw new ErroDeRegra(409, "modelo_sem_persona", "Há cartão de modelo sem persona escolhida.", { no_id: n.id });
}

/** Textos dos cartões de prompt ligados ao resultado. */
export function textosDasEntradas(e: EntradasDaSaida): { texto: string; papel: "pedido" | "restricao" }[] {
  return e.prompt
    .map((n) => ({ texto: limpo(n.dados.texto, 3000), papel: (n.dados.papel === "restricao" ? "restricao" : "pedido") as "pedido" | "restricao" }))
    .filter((t) => t.texto);
}

export const listaCurta = (v: unknown) => listaDeTextos(v, 12, 200);
