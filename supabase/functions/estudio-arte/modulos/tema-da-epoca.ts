/**
 * Tema da época no Estúdio (17/10/2026, dono: "se eu falei de Halloween tem
 * que já entender e compor com pegada Halloween; ele tem que ser inteligente
 * e proativo").
 *
 * Duas fontes, em código (sem rede, sem custo):
 * - o TEXTO do item fala da data ("halloween", "black friday", "dia das
 *   mães"...): o tema é obrigatório, a peça inteira entra no clima;
 * - a DATA de publicação cai na janela de uma data do varejo brasileiro: o
 *   tema é um convite, o diretor usa um toque da data só se combinar com o
 *   assunto (post de imposto no dia 30/10 não vira Halloween).
 *
 * Páscoa e Carnaval são calculados (domingo de Páscoa pelo algoritmo de
 * Meeus); Dia das Mães e dos Pais são o 2º domingo de maio e de agosto; Black
 * Friday é a sexta depois da 4ª quinta de novembro.
 *
 * Puro (sem Deno nem npm): a função e os testes leem o mesmo arquivo.
 * Sem lookbehind, propriedade Unicode ou grupo nomeado em regex (Safari 11).
 */

export type TemaDaEpoca = {
  nome: string;
  data: string;
  /** "pedido": o texto fala da data; "calendario": só a data de publicação cai na janela. */
  origem: "pedido" | "calendario";
  como: string;
};

type Data = { nome: string; palavras: RegExp; quando: (ano: number) => { inicio: string; fim: string; dia: string }; como: string };

const semAcento = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const iso = (ano: number, mes: number, dia: number) => `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
const somar = (data: string, dias: number) => {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
};

/** Domingo de Páscoa (calendário gregoriano, algoritmo de Meeus/Jones/Butcher). */
export function domingoDePascoa(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(ano, mes, dia);
}

/** O n-ésimo dia da semana (0 = domingo) de um mês. */
export function enesimoDiaDaSemana(ano: number, mes: number, semana: number, n: number): string {
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1, 12)).getUTCDay();
  return iso(ano, mes, 1 + ((semana - primeiro + 7) % 7) + (n - 1) * 7);
}

const fixa = (mes: number, dia: number, antes: number, depois = 0) => (ano: number) => {
  const d = iso(ano, mes, dia);
  return { inicio: somar(d, -antes), fim: somar(d, depois), dia: d };
};

export const DATAS_DO_ANO: Data[] = [
  {
    nome: "Carnaval",
    palavras: /\bcarnaval\b|\bfolia\b|\bbloquinho\b/,
    quando: (ano) => { const d = somar(domingoDePascoa(ano), -47); return { inicio: somar(d, -12), fim: somar(d, 1), dia: d }; },
    como: "confete, serpentina, glitter, máscaras e plumas, cores vibrantes como acento, energia de rua e movimento",
  },
  { nome: "Dia da Mulher", palavras: /dia (internacional )?da mulher|\b8 de marco\b/, quando: fixa(3, 8, 7), como: "homenagem com mulheres reais e diversas, flores sem clichê, força e protagonismo, nada de estereótipo" },
  { nome: "Dia do Consumidor", palavras: /dia do consumidor/, quando: fixa(3, 15, 7, 1), como: "oferta clara, etiqueta, sacola, carrinho, selo de desconto, energia de varejo" },
  {
    nome: "Páscoa",
    palavras: /\bpascoa\b|ovo de chocolate|ovos de pascoa/,
    quando: (ano) => { const d = domingoDePascoa(ano); return { inicio: somar(d, -18), fim: d, dia: d }; },
    como: "ovos de chocolate, coelho, cestas, papel celofane, tons de chocolate e pastel como acento, mesa em família",
  },
  { nome: "Dia das Mães", palavras: /dia das maes/, quando: (ano) => { const d = enesimoDiaDaSemana(ano, 5, 0, 2); return { inicio: somar(d, -16), fim: d, dia: d }; }, como: "afeto entre mãe e filho, abraço, mãos, flores, presente embrulhado, luz quente e doméstica" },
  { nome: "Dia dos Namorados", palavras: /dia dos namorados/, quando: fixa(6, 12, 12), como: "casal, corações discretos, jantar, presente, vermelho e rosa só como acento, clima de encontro" },
  {
    nome: "Festa Junina",
    palavras: /festa junina|\bjunina\b|\bjulina\b|\barraia\b|sao joao/,
    quando: (ano) => ({ inicio: iso(ano, 6, 1), fim: iso(ano, 7, 20), dia: iso(ano, 6, 24) }),
    como: "bandeirinhas, chita, fogueira, pinhão, milho, quentão, chapéu de palha, xadrez",
  },
  { nome: "Dia dos Pais", palavras: /dia dos pais/, quando: (ano) => { const d = enesimoDiaDaSemana(ano, 8, 0, 2); return { inicio: somar(d, -16), fim: d, dia: d }; }, como: "pai e filho em momento real, churrasco, ferramenta, futebol, abraço, presente, luz quente" },
  { nome: "Dia do Cliente", palavras: /dia do cliente/, quando: fixa(9, 15, 7), como: "agradecimento, brinde, cliente real sendo bem atendido, selo de presente" },
  { nome: "Dia das Crianças", palavras: /dia das criancas/, quando: fixa(10, 12, 14), como: "brinquedos, cores primárias como acento, criança brincando, balões, traço lúdico" },
  { nome: "Outubro Rosa", palavras: /outubro rosa|cancer de mama/, quando: (ano) => ({ inicio: iso(ano, 10, 1), fim: iso(ano, 10, 31), dia: iso(ano, 10, 1) }), como: "laço rosa, cuidado e prevenção, mulheres reais, rosa como acento dentro da paleta, tom acolhedor e sério" },
  {
    nome: "Halloween",
    palavras: /\bhalloween\b|dia das bruxas|dia do saci/,
    quando: fixa(10, 31, 14, 1),
    como: "abóboras esculpidas, teias, morcegos, velas, chapéu de bruxa, névoa e luz baixa, laranja e roxo escuro só como acento da paleta, divertido e sem terror pesado",
  },
  { nome: "Novembro Azul", palavras: /novembro azul|cancer de prostata|saude do homem/, quando: (ano) => ({ inicio: iso(ano, 11, 1), fim: iso(ano, 11, 30), dia: iso(ano, 11, 1) }), como: "bigode, laço azul, homens reais, cuidado com a saúde, azul como acento" },
  {
    nome: "Black Friday",
    palavras: /black ?friday|black week|black november|cyber monday/,
    quando: (ano) => { const d = somar(enesimoDiaDaSemana(ano, 11, 4, 4), 1); return { inicio: somar(d, -21), fim: somar(d, 3), dia: d }; },
    como: "preto dominante com a cor de destaque da marca, etiquetas de desconto grandes, contagem regressiva, urgência, produto em destaque",
  },
  { nome: "Natal", palavras: /\bnatal\b|natalin[oa]|papai noel|amigo secreto|ceia/, quando: fixa(12, 25, 24), como: "árvore, luzes quentes desfocadas, presentes, laços, pinhas, mesa de ceia, verde e vermelho só como acento" },
  { nome: "Ano Novo", palavras: /ano novo|reveillon|virada do ano|retrospectiva/, quando: (ano) => ({ inicio: iso(ano, 12, 26), fim: iso(ano + 1, 1, 2), dia: iso(ano, 12, 31) }), como: "fogos, brilho dourado, taças, branco, contagem regressiva, metas e recomeço" },
  { nome: "Volta às aulas", palavras: /volta as aulas|material escolar|lista escolar/, quando: (ano) => ({ inicio: iso(ano, 1, 15), fim: iso(ano, 2, 20), dia: iso(ano, 2, 1) }), como: "mochila, cadernos, lápis, sala de aula, cores escolares como acento" },
];

/**
 * O tema da época do item: primeiro o que o texto pede (obrigatório), depois a data de publicação
 * na janela de uma data do ano (convite). No máximo 2, sem repetir.
 */
export function temasDaEpoca(e: { data: string | null | undefined; textos: Array<string | null | undefined> }): TemaDaEpoca[] {
  const s = semAcento(e.textos.filter(Boolean).join("\n"));
  const saida: TemaDaEpoca[] = [];
  const dataOk = typeof e.data === "string" && /^\d{4}-\d{2}-\d{2}/.test(e.data) ? e.data.slice(0, 10) : null;
  const ano = dataOk ? Number(dataOk.slice(0, 4)) : new Date().getUTCFullYear();
  for (const d of DATAS_DO_ANO) {
    if (!d.palavras.test(s)) continue;
    saida.push({ nome: d.nome, data: d.quando(ano).dia, origem: "pedido", como: d.como });
  }
  if (dataOk) {
    const doCalendario: TemaDaEpoca[] = [];
    for (const d of DATAS_DO_ANO) {
      if (saida.some((t) => t.nome === d.nome)) continue;
      // Janela do ano da data e do ano anterior (Ano Novo atravessa o ano).
      const janela = [d.quando(ano), d.quando(ano - 1)].find((j) => dataOk >= j.inicio && dataOk <= j.fim);
      if (janela) doCalendario.push({ nome: d.nome, data: janela.dia, origem: "calendario", como: d.como });
    }
    // A data mais perto da publicação primeiro (em 27/10, Halloween antes do Outubro Rosa).
    const distancia = (t: TemaDaEpoca) => Math.abs(Date.parse(`${t.data}T12:00:00Z`) - Date.parse(`${dataOk}T12:00:00Z`));
    saida.push(...doCalendario.sort((a, b) => distancia(a) - distancia(b)));
  }
  return saida.slice(0, 2);
}

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** O bloco do tema para o diretor (vazio sem tema). */
export function blocoDoTemaDaEpoca(temas: TemaDaEpoca[]): string {
  if (!temas.length) return "";
  const linhas = temas.map((t) => t.origem === "pedido"
    ? `- ${t.nome} (${dataBr(t.data)}): o conteúdo FALA desta data. A peça inteira entra no clima: ${t.como}. O tema entra no fio_visual, na capa (o elemento forte é da data) e em cada lâmina com um objeto ou detalhe DIFERENTE da data (o objeto da capa não volta nas outras; ex.: abóbora na capa, teia em uma, vela em outra).`
    : `- ${t.nome} (${dataBr(t.data)}): a publicação cai perto desta data. Se o assunto combinar, dê um toque da data (${t.como}) na capa ou no fechamento; se não combinar, ignore e diga em avisos_para_a_equipe que a data está perto.`);
  return `TEMA DA ÉPOCA (lido da data de publicação e do texto do item)\n${linhas.join("\n")}\nAs cores da data são acento dentro da paleta da marca, nunca no lugar dela; a leitura do texto vem antes do enfeite.`;
}
