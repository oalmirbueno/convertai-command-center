/**
 * Memória e continuidade dos rituais (Frente S, 25/09/2026).
 *
 * O dono: "quando eu gerar o ritual da semana, ele não seja repetitivo, tenha
 * um contexto de continuidade, não repita a mesma mensagem que foi enviada na
 * sexta na segunda; tenha memória, aprendizado e evolução".
 *
 * Aqui ficam as regras puras (sem Deno, sem banco), cobertas pelo Vitest:
 * 1. O que um ritual disse, em forma de memória: abertura, blocos, assuntos
 *    e promessas (o que a gente combinou para a próxima vez).
 * 2. A conferência DETERMINÍSTICA de repetição: n-gramas de palavras contra
 *    os rituais anteriores, frase a frase, abertura e estrutura. Passou do
 *    limite, vira aviso na tela (o Jev confirma só como aviso). Nunca há
 *    laço de correção: o texto volta como saiu, com o aviso junto.
 * 3. A montagem do bloco de continuidade que vai para o escritor: rituais
 *    anteriores com data, promessas em aberto, o que mudou desde o último,
 *    pendências, cérebro e a fase do método.
 */

// ─── Texto normalizado ───────────────────────────────────────

/** Acentos soltos depois do NFD, montados por código (sem \p{...}). */
const MARCAS_DE_ACENTO = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

/** Palavras que não carregam assunto: não contam na comparação. */
const VAZIAS = new Set([
  "a", "o", "as", "os", "um", "uma", "de", "da", "do", "das", "dos", "e", "que", "em", "no", "na", "nos", "nas",
  "para", "pra", "por", "com", "se", "ja", "mais", "ao", "aos", "ou", "sua", "seu", "suas", "seus",
  "voce", "gente", "isso", "essa", "esse", "esta", "este", "como", "mas",
]);

export function normalizar(texto: string): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(MARCAS_DE_ACENTO, "")
    .toLowerCase()
    .replace(/\*/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function palavras(texto: string): string[] {
  return normalizar(texto).split(" ").filter((p) => p.length > 1 && !VAZIAS.has(p));
}

export function ngramas(lista: readonly string[], n: number): Set<string> {
  const saida = new Set<string>();
  if (lista.length < n) {
    if (lista.length) saida.add(lista.join(" "));
    return saida;
  }
  for (let i = 0; i + n <= lista.length; i += 1) saida.add(lista.slice(i, i + n).join(" "));
  return saida;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let comum = 0;
  for (const x of a) if (b.has(x)) comum += 1;
  return comum / (a.size + b.size - comum);
}

/** Quanto de `a` está dentro de `b` (0 a 1). */
export function contencao(a: Set<string>, b: Set<string>): number {
  if (!a.size) return 0;
  let comum = 0;
  for (const x of a) if (b.has(x)) comum += 1;
  return comum / a.size;
}

// ─── Leitura da forma do ritual ──────────────────────────────

const TITULO_DE_BLOCO = /^\*([^*]{2,60})\*:?\s*(.*)$/;
const SAUDACAO = /^(bom dia|boa tarde|boa noite|ola|oi|oii|opa)\b[^.!?\n]*[.!?,]?\s*/i;

/** Linhas que o prompt manda repetir sempre: não são repetição de conteúdo. */
function linhaFixa(linha: string): boolean {
  const n = normalizar(linha);
  return !n || n.includes("aceleriq online") || n.includes("tudo detalhado no painel");
}

/** Títulos dos blocos em negrito de WhatsApp, na ordem. */
export function blocosDoRitual(texto: string): string[] {
  return String(texto ?? "").split(/\r?\n/)
    .map((l) => l.trim().match(TITULO_DE_BLOCO))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => m[1].trim());
}

/**
 * A abertura de verdade: a primeira frase depois do cumprimento. "Bom dia,
 * Priscila." se repete toda semana por regra; o que não pode repetir é o que
 * vem logo depois.
 */
export function aberturaDoRitual(texto: string): string {
  const linhas = String(texto ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const linha of linhas) {
    if (TITULO_DE_BLOCO.test(linha)) break;
    const sem = linha.replace(SAUDACAO, "").trim();
    if (palavras(sem).length >= 4) return sem.slice(0, 240);
  }
  return "";
}

/** Frases de conteúdo (sem títulos, sem cumprimento, sem a linha fixa do painel). */
export function frasesDoRitual(texto: string): string[] {
  const saida: string[] = [];
  for (const bruta of String(texto ?? "").split(/\r?\n/)) {
    let linha = bruta.trim();
    if (!linha || linhaFixa(linha)) continue;
    const titulo = linha.match(TITULO_DE_BLOCO);
    if (titulo) linha = titulo[2].trim();
    linha = linha.replace(/^[•\-–]\s*/, "").replace(SAUDACAO, "").trim();
    if (!linha) continue;
    for (const frase of linha.split(/(?:[.!?;])\s+/)) {
      const f = frase.trim();
      if (palavras(f).length >= 5) saida.push(f);
    }
  }
  return saida;
}

function corpoComparavel(texto: string): string[] {
  return frasesDoRitual(texto).flatMap((f) => palavras(f));
}

// ─── Memória do ritual ───────────────────────────────────────

export interface MemoriaDoRitual {
  abertura: string;
  /** Títulos dos blocos na ordem (a estrutura usada). */
  estrutura: string[];
  /** Um assunto por bloco: "Título: primeira frase". */
  assuntos: string[];
  /** O que ficou combinado para a próxima vez. */
  promessas: string[];
}

const BLOCO_DE_PROMESSA = /o que vem agora|precisamos de voc|pr[oó]ximos? passos?|pr[oó]xima semana|o que vem/i;

/** O que o ritual disse, compacto, para a próxima semana lembrar. */
export function extrairMemoriaDoRitual(texto: string, proximoPasso?: string | null): MemoriaDoRitual {
  const linhas = String(texto ?? "").split(/\r?\n/);
  const assuntos: string[] = [];
  const promessas: string[] = [];
  let titulo: string | null = null;
  let primeiraDoBloco = true;
  let emPromessa = false;
  for (const bruta of linhas) {
    const linha = bruta.trim();
    if (!linha) continue;
    const m = linha.match(TITULO_DE_BLOCO);
    if (m) {
      titulo = m[1].trim();
      emPromessa = BLOCO_DE_PROMESSA.test(titulo);
      primeiraDoBloco = true;
      const resto = m[2].trim();
      if (resto) {
        assuntos.push(`${titulo}: ${resto.slice(0, 160)}`);
        primeiraDoBloco = false;
        if (emPromessa) promessas.push(resto.replace(/^[•\-–]\s*/, "").slice(0, 220));
      }
      continue;
    }
    if (!titulo || linhaFixa(linha)) continue;
    const limpa = linha.replace(/^[•\-–]\s*/, "");
    if (primeiraDoBloco) {
      assuntos.push(`${titulo}: ${limpa.slice(0, 160)}`);
      primeiraDoBloco = false;
    }
    if (emPromessa) promessas.push(limpa.slice(0, 220));
  }
  const passo = String(proximoPasso ?? "").trim();
  if (passo && !promessas.some((p) => contencao(ngramas(palavras(passo), 3), ngramas(palavras(p), 3)) > 0.6)) {
    promessas.unshift(passo.slice(0, 240));
  }
  return {
    abertura: aberturaDoRitual(texto),
    estrutura: blocosDoRitual(texto),
    assuntos: assuntos.slice(0, 8),
    promessas: promessas.slice(0, 6),
  };
}

// ─── Conferência de repetição ────────────────────────────────

/** Semelhança geral (Jaccard de trigramas) a partir da qual o texto é quase o mesmo. */
export const LIMITE_INDICE = 0.3;
/** Uma frase conta como repetida quando 60% dos quadrigramas dela já foram ditos. */
export const LIMITE_FRASE = 0.6;
/** Com 2 frases repetidas o cliente já percebe. */
export const LIMITE_FRASES = 2;
/** Abertura repetida: 60% dos trigramas da abertura já usados numa abertura anterior. */
export const LIMITE_ABERTURA = 0.6;

export interface RitualParaComparar {
  quando: string;
  titulo?: string | null;
  texto: string;
}

export interface ResultadoDaRepeticao {
  /** 0 a 1: semelhança com o ritual anterior mais parecido. */
  indice: number;
  mais_parecido: { quando: string; titulo: string | null; indice: number } | null;
  frases_repetidas: Array<{ frase: string; de: string }>;
  abertura_repetida: { abertura: string; de: string } | null;
  estrutura_igual: { de: string } | null;
  acima_do_limite: boolean;
  /** Em português, para o aviso da tela. */
  motivos: string[];
  comparados: number;
}

const dataCurta = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
};

/**
 * Compara o ritual novo com os anteriores. Determinístico e barato: roda em
 * milissegundos, sem rede. Quem chama decide o que fazer com o aviso.
 */
export function verificarRepeticao(novo: string, anteriores: readonly RitualParaComparar[]): ResultadoDaRepeticao {
  const validos = anteriores.filter((a) => a && String(a.texto ?? "").trim().length > 40);
  const vazio: ResultadoDaRepeticao = {
    indice: 0, mais_parecido: null, frases_repetidas: [], abertura_repetida: null, estrutura_igual: null,
    acima_do_limite: false, motivos: [], comparados: validos.length,
  };
  if (!String(novo ?? "").trim() || !validos.length) return vazio;

  const tri = ngramas(corpoComparavel(novo), 3);
  let melhor: ResultadoDaRepeticao["mais_parecido"] = null;
  const quadAnteriores = validos.map((a) => ({ a, quad: ngramas(corpoComparavel(a.texto), 4) }));
  for (const a of validos) {
    const indice = Math.round(jaccard(tri, ngramas(corpoComparavel(a.texto), 3)) * 100) / 100;
    if (!melhor || indice > melhor.indice) melhor = { quando: a.quando, titulo: a.titulo ?? null, indice };
  }

  const frases_repetidas: ResultadoDaRepeticao["frases_repetidas"] = [];
  for (const frase of frasesDoRitual(novo)) {
    const q = ngramas(palavras(frase), 4);
    if (q.size < 2) continue;
    const achou = quadAnteriores.find(({ quad }) => contencao(q, quad) >= LIMITE_FRASE);
    if (achou) frases_repetidas.push({ frase: frase.slice(0, 200), de: achou.a.quando });
    if (frases_repetidas.length >= 6) break;
  }

  let abertura_repetida: ResultadoDaRepeticao["abertura_repetida"] = null;
  const abertura = aberturaDoRitual(novo);
  const triAbertura = ngramas(palavras(abertura), 3);
  if (abertura && triAbertura.size >= 2) {
    for (const a of validos) {
      const anterior = aberturaDoRitual(a.texto);
      if (anterior && contencao(triAbertura, ngramas(palavras(anterior), 3)) >= LIMITE_ABERTURA) {
        abertura_repetida = { abertura: abertura.slice(0, 200), de: a.quando };
        break;
      }
    }
  }

  // Estrutura: a mesma sequência de títulos do ritual imediatamente anterior.
  let estrutura_igual: ResultadoDaRepeticao["estrutura_igual"] = null;
  const estrutura = blocosDoRitual(novo).map(normalizar).join("|");
  const ultimo = validos[0];
  if (estrutura && blocosDoRitual(novo).length >= 3 && blocosDoRitual(ultimo.texto).map(normalizar).join("|") === estrutura) {
    estrutura_igual = { de: ultimo.quando };
  }

  const motivos: string[] = [];
  if (melhor && melhor.indice >= LIMITE_INDICE) {
    motivos.push(`O texto está ${Math.round(melhor.indice * 100)}% parecido com o ritual de ${dataCurta(melhor.quando)}.`);
  }
  if (frases_repetidas.length >= LIMITE_FRASES) {
    motivos.push(`${frases_repetidas.length} frase(s) já foram ditas em rituais anteriores.`);
  }
  if (abertura_repetida) motivos.push(`A abertura repete a do ritual de ${dataCurta(abertura_repetida.de)}.`);
  if (estrutura_igual) motivos.push(`Os blocos seguem a mesma sequência de títulos do ritual de ${dataCurta(estrutura_igual.de)}.`);

  const acima_do_limite = Boolean(
    (melhor && melhor.indice >= LIMITE_INDICE) || frases_repetidas.length >= LIMITE_FRASES || abertura_repetida,
  );
  return { indice: melhor?.indice ?? 0, mais_parecido: melhor, frases_repetidas, abertura_repetida, estrutura_igual, acima_do_limite, motivos, comparados: validos.length };
}

// ─── Bloco de continuidade para o escritor ───────────────────

export interface RitualAnterior {
  quando: string;
  /** Chave do ritual (rota_semana, meio_semana...) quando conhecida. */
  tipo: string | null;
  titulo: string | null;
  texto: string;
  proximo_passo: string | null;
  situacao: "enviado" | "rascunho";
  /** Memória gravada no envio; sem ela, é extraída do texto. */
  memoria?: MemoriaDoRitual | null;
}

export interface MovimentoResumido {
  quando: string;
  titulo: string;
  detalhe?: string | null;
  visivel_ao_cliente?: boolean;
}

export interface PendenciasAbertas {
  aprovacoes: Array<{ nome: string; dias: number | null }>;
  tarefasAtrasadas: Array<{ titulo: string; prazo: string | null }>;
  pedidosAbertos: Array<{ titulo: string; dias: number | null }>;
  agendaProxima: Array<{ titulo: string; quando: string }>;
}

export interface EntradaDaContinuidade {
  agora: Date;
  ritualPedido: string;
  rituais: readonly RitualAnterior[];
  movimentos: readonly MovimentoResumido[];
  desde: string | null;
  pendencias: PendenciasAbertas;
  numeros?: string;
  cerebro?: string;
  metodo?: string;
  /** Teto do bloco inteiro (caracteres). */
  limite?: number;
}

const NOME_DO_RITUAL: Record<string, string> = {
  rota_semana: "Rota da semana (segunda)",
  meio_semana: "Meio da semana (quarta)",
  prova_movimento: "Prova de movimento (sexta)",
  radar_aceleriq: "Radar (mensal)",
  marco_90: "Marco de 90 dias",
};

const PROGRESSAO: Record<string, string> = {
  rota_semana: "Segunda PLANEJA: parte do que a sexta passada fechou e do que ficou combinado, e diz o plano novo desta semana. Não repete o balanço da sexta.",
  meio_semana: "Quarta ACOMPANHA: parte do plano que a segunda apresentou e diz o que já saiu do papel desde então. Não repete o plano da segunda.",
  prova_movimento: "Sexta FECHA: parte do que a segunda prometeu e prova o que virou realidade até hoje. Não repete o plano da segunda; mostra o resultado dele.",
  radar_aceleriq: "Radar ANTECIPA: nada do dia a dia da semana; o assunto é o que vem pela frente.",
  marco_90: "Marco FAZ O BALANÇO: compara o começo do trimestre com hoje.",
};

function dataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dia = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  const hora = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return `${dia} ${hora}`;
}

const cortar = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * O bloco de MEMÓRIA E CONTINUIDADE que o escritor recebe além dos fatos do
 * painel. Ordem pensada: primeiro a regra da progressão, depois o que já foi
 * dito (para não repetir), as promessas (para retomar), o que mudou desde o
 * último, as pendências, o cérebro e o método. Teto de caracteres sempre.
 */
export function montarContextoDeContinuidade(e: EntradaDaContinuidade): string {
  const limite = e.limite ?? 9000;
  const partes: string[] = [];
  partes.push([
    `PROGRESSÃO DA SEMANA: ${PROGRESSAO[e.ritualPedido] ?? PROGRESSAO.meio_semana}`,
  ].join("\n"));
  // O método vem logo depois: é curto e decide o tom da condução.
  if (e.metodo) partes.push(e.metodo);

  const rituais = e.rituais.slice(0, 8);
  if (rituais.length) {
    const linhas = rituais.map((r, i) => {
      const mem = r.memoria ?? extrairMemoriaDoRitual(r.texto, r.proximo_passo);
      const cab = `- ${dataHora(r.quando)} · ${NOME_DO_RITUAL[r.tipo ?? ""] ?? (r.tipo || "mensagem")} · ${r.situacao === "enviado" ? "ENVIADO" : "rascunho não enviado"}${r.titulo ? ` · "${cortar(r.titulo, 80)}"` : ""}`;
      const detalhes = [
        mem.abertura ? `  abertura usada: "${cortar(mem.abertura, 160)}"` : "",
        mem.estrutura.length ? `  blocos usados: ${mem.estrutura.join(" > ")}` : "",
        mem.assuntos.length ? `  assuntos: ${mem.assuntos.map((a) => cortar(a, 120)).join(" | ")}` : "",
        mem.promessas.length ? `  combinado: ${mem.promessas.map((p) => cortar(p, 160)).join(" | ")}` : "",
        // Os dois mais recentes vão com texto: é deles que a repetição mais aparece.
        i < 2 ? `  texto: ${cortar(r.texto.replace(/\s+/g, " "), i === 0 ? 900 : 500)}` : "",
      ].filter(Boolean);
      return [cab, ...detalhes].join("\n");
    });
    partes.push([
      `O QUE JÁ FOI DITO A ESTE CLIENTE (rituais das últimas semanas, do mais recente ao mais antigo). É PROIBIDO repetir a abertura, frases, a mesma sequência de blocos ou um assunto já contado como se fosse novo. O que já foi dito só volta como continuação ("na segunda a gente combinou X; X já está no ar"):`,
      ...linhas,
    ].join("\n"));

    const ultimoEnviado = rituais.find((r) => r.situacao === "enviado");
    if (ultimoEnviado) {
      const mem = ultimoEnviado.memoria ?? extrairMemoriaDoRitual(ultimoEnviado.texto, ultimoEnviado.proximo_passo);
      if (mem.promessas.length) {
        partes.push([
          `PROMESSAS DO ÚLTIMO RITUAL ENVIADO (${dataHora(ultimoEnviado.quando)}). Retome CADA uma dizendo o que andou, com o fato que prova; se os fatos não mostram o andamento, trate como acompanhamento, nunca como atraso:`,
          ...mem.promessas.map((p) => `- ${cortar(p, 220)}`),
        ].join("\n"));
      }
    }
  } else {
    partes.push("O QUE JÁ FOI DITO: não há ritual registrado nas últimas semanas. Se for a primeira mensagem, apresente o ritmo de acompanhamento sem repetir o que o dossiê já diz.");
  }

  if (e.movimentos.length) {
    const visiveis = e.movimentos.slice(0, 30).map((m) =>
      `- ${dataHora(m.quando)} · ${cortar(m.titulo, 140)}${m.detalhe ? ` (${cortar(String(m.detalhe), 100)})` : ""}${m.visivel_ao_cliente === false ? " [interno: não citar ao cliente]" : ""}`);
    partes.push([
      `O QUE MUDOU DESDE O ÚLTIMO RITUAL${e.desde ? ` (${dataHora(e.desde)})` : ""}: é o coração do avanço; cite com o dia certo.`,
      ...visiveis,
      e.movimentos.length > 30 ? `(+${e.movimentos.length - 30} movimentos no histórico.)` : "",
    ].filter(Boolean).join("\n"));
  } else if (e.desde) {
    partes.push(`O QUE MUDOU DESDE O ÚLTIMO RITUAL (${dataHora(e.desde)}): o painel não registrou movimento. Isso NÃO prova que nada andou; conte o trabalho de bastidor que os fatos mostrarem e nunca escreva ausência.`);
  }

  const p = e.pendencias;
  const linhasPend = [
    ...p.aprovacoes.slice(0, 5).map((a) => `- Pronto esperando o aval do cliente: ${cortar(a.nome, 100)}${a.dias !== null ? ` (há ${a.dias} dia(s))` : ""}`),
    ...p.tarefasAtrasadas.slice(0, 5).map((t) => `- Tarefa interna com prazo vencido: ${cortar(t.titulo, 100)}${t.prazo ? ` (prazo ${t.prazo.split("-").reverse().slice(0, 2).join("/")})` : ""} [interno: não citar ao cliente]`),
    ...p.pedidosAbertos.slice(0, 4).map((r) => `- Pedido do cliente em aberto: ${cortar(r.titulo, 100)}${r.dias !== null ? ` (há ${r.dias} dia(s))` : ""}`),
    ...p.agendaProxima.slice(0, 5).map((a) => `- Agendado: ${cortar(a.titulo, 100)} em ${dataHora(a.quando)}`),
  ];
  if (linhasPend.length) {
    partes.push(["PENDÊNCIAS E AGENDA HOJE (o que depende do cliente entra pelo ganho; o interno orienta as tarefas sugeridas):", ...linhasPend].join("\n"));
  }

  if (e.numeros) partes.push(e.numeros);
  if (e.cerebro) partes.push(e.cerebro);

  // Teto: corta pelo fim. A ordem acima é a prioridade: progressão, método e
  // o que já foi dito primeiro; o cérebro é o primeiro a encolher.
  const saida: string[] = [];
  let total = 0;
  for (const parte of partes) {
    if (total + parte.length + 2 > limite) {
      const sobra = limite - total - 40;
      if (sobra > 300) saida.push(`${parte.slice(0, sobra).trimEnd()}\n[cortado para caber]`);
      break;
    }
    saida.push(parte);
    total += parte.length + 2;
  }
  return saida.join("\n\n");
}
