/**
 * Operações de conteúdo na conversa com o diretor (02/10, dono: "o diretor
 * não é inteligente: pedi para mudar TODO o conteúdo e ele só acrescentou um
 * card com o mesmo conteúdo").
 *
 * Causa (duas, em código):
 * 1. "muda todo o conteúdo" não liberava a troca de texto: pedidoMexeNoTexto
 *    conhecia "texto", "título", "frase", mas não "conteúdo", "tema" nem
 *    "assunto". Com o texto travado, o diretor só tinha as ações de lâmina, e
 *    a mais próxima era duplicar_lamina (a cópia com o mesmo texto).
 * 2. Nada conferia que o pedido amplo cobriu todas as lâminas.
 *
 * Agora a intenção é lida em código antes do diretor (reescrever_tudo,
 * reescrever_lamina, adicionar_lamina, tirar_lamina, reordenar) e:
 * - reescrever_tudo: o diretor recebe a ordem de reescrever o texto_exato de
 *   CADA lâmina (uma mudança por lâmina, a mesma quantidade de lâminas, o
 *   layout fica ou é ajustado); duplicar, adicionar e tirar lâmina saem da
 *   proposta; a lâmina que ele esqueceu é reescrita numa chamada só ao
 *   redator (sem laço). As mudanças seguem o contrato de sempre: ordem clara
 *   vai direto com Desfazer; senão, Confirmar.
 * - adicionar_lamina: lâmina NOVA com outro texto (não a cópia).
 * - tirar_lamina: os números citados no pedido são lidos em código
 *   (laminasParaTirar) e viram a reserva da proposta quando o diretor não
 *   devolve a ação (uma ou várias lâminas no mesmo pedido).
 *
 * Puro (sem Deno): a função e os testes leem o mesmo arquivo.
 * Sem lookbehind, propriedade Unicode ou grupo nomeado em regex (Safari 11).
 */

export type IntencaoDeConteudo = "reescrever_tudo" | "reescrever_lamina" | "adicionar_lamina" | "tirar_lamina" | "reordenar";

export const ROTULO_DA_INTENCAO: Record<IntencaoDeConteudo, string> = {
  reescrever_tudo: "Reescrever todo o conteúdo",
  reescrever_lamina: "Reescrever a lâmina",
  adicionar_lamina: "Lâmina nova",
  tirar_lamina: "Tirar lâmina",
  reordenar: "Mudar a ordem",
};

const semAcento = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const VERBO_DE_REESCRITA = "(mud|troc|troq|refa|refaz|reescrev|escrev|alter|substitu|renov|recri|cri)[a-z]*";
const ALVO_DO_CONTEUDO = "(conteudo|conteudos|texto|textos|copy|copys|mensagem|tema|assunto|roteiro)";

/**
 * A intenção de conteúdo da mensagem, pelas palavras (sem rede). Null quando
 * não é pedido de conteúdo (cor, cena, foto, opinião): segue o fluxo de sempre.
 */
export function intencaoDeConteudo(mensagem: string): IntencaoDeConteudo | null {
  const m = semAcento(mensagem).replace(/\s+/g, " ").trim();
  if (!m) return null;
  if (/(^|[^a-z])(adicion|acrescent|inclu|cri|faz|faca|coloc|p[oõ]e|ponh)[a-z]* (mais )?(uma |1 |outra |nova )+(lamina|card|slide)/.test(m) || /(lamina|card|slide) (nova|a mais|extra)\b/.test(m)) return "adicionar_lamina";
  const tudo = "(todo|toda|todos|todas|tudo|inteiro|inteira|geral)";
  if (
    new RegExp(`${VERBO_DE_REESCRITA} ${tudo} (o |a |os |as )?${ALVO_DO_CONTEUDO}`).test(m) ||
    new RegExp(`${VERBO_DE_REESCRITA} (o |a |os |as )?${ALVO_DO_CONTEUDO} (de |d[ae]s? )?${tudo}`).test(m) ||
    new RegExp(`${ALVO_DO_CONTEUDO} (de |d[ae]s? )?(tudo|todas as laminas|todos os cards|todos os slides|todo o carrossel|o carrossel inteiro)`).test(m) && new RegExp(VERBO_DE_REESCRITA).test(m) ||
    new RegExp(`(mud|troc|troq|alter)[a-z]* (o |de )?(tema|assunto)\\b`).test(m) ||
    /(outro|novo) (tema|assunto|conteudo)\b/.test(m) ||
    /(refaz|refaca|reescrev)[a-z]* tudo\b/.test(m)
  ) return "reescrever_tudo";
  if (/(tir|remov|apag|exclu|delet)[a-z]* (as? |os? |ess[ae]s? |est[ae]s? )?(\d+[a-z]* )?(lamina|card|slide)/.test(m)) return "tirar_lamina";
  if (/(reorden|invert)[a-z]*|(muda|troca|mude|troque) a ordem|(move|mova|passa|passe) a (lamina|card|slide)/.test(m)) return "reordenar";
  if (new RegExp(`${VERBO_DE_REESCRITA} (o |a )?${ALVO_DO_CONTEUDO}`).test(m)) return "reescrever_lamina";
  return null;
}

const VERBO_DE_TIRAR = "(tir|retir|remov|apag|exclu|delet)[a-z]*";
const NOME_DA_LAMINA = "(laminas?|cards?|slides?)";
const NUMERO_DA_LAMINA = "(\\d{1,2})(?!\\d)";
/**
 * Negação logo antes do verbo de tirar: "não tira", "não precisa mais tirar", "não quero mais tirar", "nunca vamos
 * tirar", "sem tirar", "nem precisa tirar". Só palavras de apoio conhecidas entre a negação e o verbo (vírgula corta:
 * "não, tira a lâmina 3" vale como pedido).
 */
const APOIO_DA_NEGACAO = "(e|pode|podes|podem|precisa|precisam|precisamos|preciso|quero|queria|quer|querem|queremos|deve|devo|devemos|deveria|vai|vou|vamos|para|pra|de|mais|mesmo|ainda|tem|temos|que|e pra|e para|precisar|voce|voces|a gente|eu|nos|se|e necessario|faz sentido|da|consigo|e preciso)";
const NEGACAO_ANTES_DO_VERBO = new RegExp(`(^|[^a-z])(nao|nunca|sem|nem|jamais)( ${APOIO_DA_NEGACAO})* $`);

/** Depois do número, o que mostra que ele não é uma lâmina ("3 fotos", "2x", "50%"). */
const NAO_E_LAMINA = /^([a-z%]| ?(fotos?|imagem|imagens|versao|versoes|vez|vezes|linhas?|palavras?|itens|item|logos?|textos?|opcoes|opcao|por cento)\b)/;

/**
 * As lâminas que a mensagem manda tirar, pelos números escritos nela (sem rede), na ordem em que aparecem e sem
 * repetir: "tira a lâmina 3", "tirar lâmina 7 e tirar lâmina 6", "tirar as lâminas 6 e 7", "tira as lâminas 2 a 4".
 * Cuidadoso de propósito: só número ligado ao verbo de tirar e à palavra lâmina (card, slide); nada de adivinhar
 * "a última" ou "a do café" (isso é do diretor). Frase negada ("não tira a lâmina 3") ou pergunta não conta.
 * Número que não é lâmina do trabalho (`ordens`) fica de fora; na dúvida sobre um número, a frase inteira sai.
 */
export function laminasParaTirar(mensagem: string, ordens: number[]): number[] {
  const m = semAcento(mensagem).replace(/[ \t]+/g, " ");
  const citadas: number[] = [];
  const cita = (n: number) => { if (ordens.indexOf(n) >= 0 && citadas.indexOf(n) < 0) citadas.push(n); };
  // Frase a frase (o ponto de "n. 3" não é fim de frase).
  const frases = m.replace(/([!?\n;]+|\.(?!\d)(?! ?\d))/g, "$1\u0001").split("\u0001");
  for (const frase of frases) {
    if (/\?\s*$/.test(frase)) continue;
    // Escolha ("tira a lâmina 3 ou tira a lâmina 4", "a 3 ou a 4"): a frase inteira não monta lista; a equipe decide.
    if (/(^|[^a-z])ou([^a-z]|$)/.test(frase) && new RegExp(`(^|[^a-z])${VERBO_DE_TIRAR}`).test(frase)) continue;
    const verbo = new RegExp(`(^|[^a-z])${VERBO_DE_TIRAR} (fora )?(as? |os? |ess[ae]s? |est[ae]s? )?`, "g");
    let v: RegExpExecArray | null;
    while ((v = verbo.exec(frase))) {
      const antes = frase.slice(0, v.index + v[1].length);
      if (NEGACAO_ANTES_DO_VERBO.test(antes)) continue;
      const resto = frase.slice(v.index + v[0].length);
      // "a 3ª lâmina", "o 2o card".
      const ordinal = new RegExp(`^${NUMERO_DA_LAMINA}[ªºa-z]{0,2} ${NOME_DA_LAMINA}\\b`).exec(resto);
      if (ordinal) {
        cita(Number(ordinal[1]));
        continue;
      }
      // "lâmina 3", "lâminas 6 e 7", "lâminas 2, 4 e a 5", "lâminas 2 a 4".
      const nome = new RegExp(`^${NOME_DA_LAMINA} (numero |n[.º°]? ?)?`).exec(resto);
      if (!nome) continue;
      let pos = nome[0].length;
      const numeros: number[] = [];
      let duvida = false;
      let primeiro = true;
      while (true) {
        const ligacao = primeiro ? /^/ : new RegExp(`^ ?(,|e|mais|&|\\+|, e) ?(tambem )?(as? |os? )?(${NOME_DA_LAMINA} )?(?=\\d)`);
        const l = ligacao.exec(resto.slice(pos));
        const faixa = primeiro ? null : /^ ?(a|ate|ate a|-) ?(?=\d)/.exec(resto.slice(pos));
        if (!l && !faixa) break;
        const depois = pos + (l ? l[0].length : (faixa as RegExpExecArray)[0].length);
        const n = new RegExp(`^${NUMERO_DA_LAMINA}`).exec(resto.slice(depois));
        if (!n) {
          // Sem número depois da palavra lâmina, ou número com mais de dois dígitos ("2026"): não é lâmina.
          if (primeiro || /^\d/.test(resto.slice(depois))) duvida = true;
          break;
        }
        const fim = depois + n[0].length;
        if (NAO_E_LAMINA.test(resto.slice(fim))) {
          duvida = true;
          break;
        }
        const valor = Number(n[1]);
        if (l) numeros.push(valor);
        else {
          const de = numeros[numeros.length - 1];
          if (valor <= de || valor - de > 10) {
            duvida = true;
            break;
          }
          for (let k = de + 1; k <= valor; k++) numeros.push(k);
        }
        pos = fim;
        primeiro = false;
      }
      // "a lâmina 3 ou 4" é escolha, não lista: a equipe decide.
      if (/^ ?ou\b/.test(resto.slice(pos))) duvida = true;
      if (!duvida) numeros.forEach(cita);
    }
  }
  return citadas;
}

/** As operações que um pedido de reescrita total nunca usa (mudam a quantidade de lâminas). */
export const FORA_DA_REESCRITA_TOTAL = ["duplicar_lamina", "adicionar_lamina", "tirar_lamina"];

/** O bloco do pedido ao diretor quando a equipe quer reescrever tudo. */
export function blocoDaReescritaTotal(total: number, ordens: number[]): string {
  return `PEDIDO DE REESCREVER TODO O CONTEÚDO (código leu: reescrever_tudo)
- Reescreva o texto_exato de TODAS as ${total} lâminas (${ordens.map((o) => `lâmina ${o}`).join(", ")}): UMA mudança por lâmina, alvo "lamina", com o texto completo novo em texto_exato. Nenhuma lâmina fica com o texto de antes.
- A mesma quantidade de lâminas: nunca use duplicar_lamina, adicionar_lamina nem tirar_lamina neste pedido. Mantenha o layout de cada lâmina; mude zona_texto, imagem ou tratamento só quando o texto novo pedir.
- Conteúdo novo de verdade: se a equipe disse o tema novo, siga; senão, um ângulo novo do mesmo assunto da marca, específico do nicho, com exemplo, passo ou situação real (sem fato inventado). A capa ganha um gancho novo; o fechamento, um CTA.`;
}

type MudancaBruta = { alvo?: unknown; ordem?: unknown; campos?: unknown; [k: string]: unknown };

/**
 * As lâminas cuja reescrita veio na resposta (mudança de lâmina com
 * texto_exato diferente do atual) e as que faltam.
 */
export function coberturaDaReescrita(mudancas: unknown, atual: Record<number, string>): { cobertas: number[]; faltam: number[] } {
  const lista = (Array.isArray(mudancas) ? mudancas : []) as MudancaBruta[];
  const ordens = Object.keys(atual).map(Number).sort((a, b) => a - b);
  const cobertas: number[] = [];
  for (const m of lista) {
    if (!m || m.alvo !== "lamina") continue;
    const o = Number(m.ordem);
    const campos = (m.campos && typeof m.campos === "object" ? m.campos : {}) as Record<string, unknown>;
    const novo = String(campos.texto_exato == null ? "" : campos.texto_exato).trim();
    if (ordens.indexOf(o) >= 0 && novo && novo !== String(atual[o] || "").trim() && cobertas.indexOf(o) < 0) cobertas.push(o);
  }
  return { cobertas: cobertas.sort((a, b) => a - b), faltam: ordens.filter((o) => cobertas.indexOf(o) < 0) };
}

/** As ações do modelo sem as que mudam a quantidade de lâminas (reescrita total). Devolve também o que saiu. */
export function acoesSemMudarQuantidade(acoes: unknown): { acoes: unknown; tiradas: string[] } {
  if (!acoes || typeof acoes !== "object") return { acoes, tiradas: [] };
  const o = acoes as { itens?: unknown };
  const itens = Array.isArray(o.itens) ? (o.itens as Array<{ operacao?: string }>) : [];
  const tiradas = itens.filter((i) => i && FORA_DA_REESCRITA_TOTAL.indexOf(String(i.operacao)) >= 0).map((i) => String(i.operacao));
  if (!tiradas.length) return { acoes, tiradas };
  return { acoes: { ...o, itens: itens.filter((i) => !(i && FORA_DA_REESCRITA_TOTAL.indexOf(String(i.operacao)) >= 0)) }, tiradas };
}

// ------------------------------------------------------------------ as que faltaram (uma chamada)

export const ESQUEMA_DA_REESCRITA = {
  nome: "reescrita_das_laminas",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["laminas"],
    properties: {
      laminas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ordem", "texto"],
          properties: { ordem: { type: "integer" }, texto: { type: "string" } },
        },
      },
    },
  },
};

export const INSTRUCOES_DA_REESCRITA = `REESCRITA DAS LÂMINAS (Estúdio)
Você é o redator sênior da agência. A equipe pediu para mudar todo o conteúdo do carrossel. Algumas lâminas já têm o texto novo (em \`ja_reescritas\`); escreva o texto novo SÓ das lâminas em \`reescrever\`, continuando a mesma história das já reescritas.
- Texto completo da lâmina, pronto para a arte, com quebra de linha entre título e apoio. Capa: gancho curto. Fechamento: CTA.
- Específico do nicho da marca, com exemplo, passo ou situação real. Nunca invente preço, número, prazo, nome ou promessa.
- Nada repetido do texto antigo nem de outra lâmina. Português do Brasil, sem travessão, sem hashtag, @ ou emoji.`;

export function pedidoDaReescrita(e: { mensagem: string; cards: Array<{ ordem: number; funcao?: string | null; texto_exato?: string | null }>; novos: Record<number, string>; faltam: number[]; marca?: string | null; conceito?: string | null }): string {
  return `Escreva o texto novo das lâminas ${e.faltam.join(", ")}. Contexto em JSON:\n${JSON.stringify({
    pedido_da_equipe: e.mensagem,
    marca: e.marca || null,
    conceito: e.conceito || null,
    ja_reescritas: Object.keys(e.novos).map(Number).sort((a, b) => a - b).map((o) => ({ ordem: o, texto: e.novos[o] })),
    reescrever: e.cards.filter((c) => e.faltam.indexOf(c.ordem) >= 0).map((c) => ({ ordem: c.ordem, funcao: c.funcao || null, texto_antigo: c.texto_exato || "" })),
  })}`;
}

/** As mudanças brutas (mesma forma do diretor) para as lâminas que faltaram, a partir do que o redator devolveu. */
export function mudancasDaReescrita(bruto: unknown, faltam: number[], atual: Record<number, string>): MudancaBruta[] {
  const lista = bruto && typeof bruto === "object" && Array.isArray((bruto as { laminas?: unknown }).laminas) ? ((bruto as { laminas: unknown[] }).laminas as Array<Record<string, unknown>>) : [];
  const saida: MudancaBruta[] = [];
  for (const o of faltam) {
    const l = lista.filter((x) => x && Number(x.ordem) === o)[0];
    const texto = l ? String(l.texto == null ? "" : l.texto).replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/[ \t]+/g, " ").trim().slice(0, 1200) : "";
    if (!texto || texto === String(atual[o] || "").trim()) continue;
    saida.push({ alvo: "lamina", ordem: o, titulo: `Texto novo da lâmina ${o}`, motivo: "Reescrita pedida para todo o conteúdo.", campos: { texto_exato: texto } });
  }
  return saida;
}
