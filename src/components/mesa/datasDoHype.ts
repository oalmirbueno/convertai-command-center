/**
 * Calendário FIXO do Hype (21/10/2026, pedido do dono: "a área de hype e a de trending, que é diferente").
 *
 * Hype = datas e eventos que vêm por aí (Black Friday, Natal, Dia das Mães, datas de profissão e do nicho).
 * Cada data tem a janela: quando começa a aquecer, o pico (o dia) e o fim. As datas móveis são calculadas
 * (Páscoa pelo algoritmo de Meeus; Carnaval = Páscoa − 47; Dia das Mães = 2º domingo de maio; Dia dos Pais =
 * 2º domingo de agosto; Black Friday = a sexta depois da 4ª quinta de novembro, que quase sempre é a última
 * sexta). Puro: nada de rede, nada de IA. A ordem por relevância ao cliente vem do Jev no servidor
 * (agente-calendario/ordenar_datas_do_hype); sem ela, a ordem é a da data.
 *
 * Datas civis em UTC ao meio-dia (evita troca de dia por fuso). Sem regex nova (Safari 11).
 */

export type TipoDeData = "varejo" | "cultural" | "consciencia" | "profissao" | "gastronomia";

export const ROTULO_DO_TIPO_DE_DATA: Record<TipoDeData, string> = {
  varejo: "Varejo",
  cultural: "Cultura e feriado",
  consciencia: "Mês temático",
  profissao: "Profissão",
  gastronomia: "Gastronomia",
};

type Regra =
  | { dia: number; mes: number }
  | { calcular: (ano: number) => string }
  | { mesInteiro: number };

interface Definicao {
  id: string;
  titulo: string;
  tipo: TipoDeData;
  regra: Regra;
  /** Dias antes do pico em que o assunto começa a aquecer. */
  aquece: number;
  /** Dias depois do pico em que ainda vale (0: acaba no dia). */
  depois?: number;
  porQue: string;
  comoUsar: string;
}

export interface DataDoHype {
  id: string;
  titulo: string;
  tipo: TipoDeData;
  /** Começa a aquecer (AAAA-MM-DD). */
  inicio: string;
  /** O dia (ou o 1º dia do mês temático). */
  pico: string;
  /** Último dia que ainda vale. */
  fim: string;
  mesInteiro: boolean;
  porQue: string;
  comoUsar: string;
}

// ------------------------------------------------------------------ datas civis

const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
export const isoDe = (ano: number, mes: number, dia: number) => `${ano}-${dois(mes)}-${dois(dia)}`;
const comoData = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

export function somarDiasIso(iso: string, dias: number): string {
  const d = comoData(iso);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function diasEntre(de: string, ate: string): number {
  return Math.round((comoData(ate).getTime() - comoData(de).getTime()) / 86_400_000);
}

/** Segunda-feira da semana da data. */
export function segundaDe(iso: string): string {
  const dia = comoData(iso).getUTCDay();
  return somarDiasIso(iso, dia === 0 ? -6 : 1 - dia);
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDe(ano, mes, dia);
}

/**
 * O n-ésimo dia da semana do mês (diaDaSemana 0 = domingo). n = -1: o último.
 * Ex.: Dia das Mães = nEsimoDiaDaSemana(ano, 5, 0, 2).
 */
export function nEsimoDiaDaSemana(ano: number, mes: number, diaDaSemana: number, n: number): string {
  if (n === -1) {
    const ultimo = comoData(isoDe(ano, mes, 1));
    ultimo.setUTCMonth(ultimo.getUTCMonth() + 1, 0);
    const recuo = (ultimo.getUTCDay() - diaDaSemana + 7) % 7;
    ultimo.setUTCDate(ultimo.getUTCDate() - recuo);
    return ultimo.toISOString().slice(0, 10);
  }
  const primeiro = comoData(isoDe(ano, mes, 1));
  const avanco = (diaDaSemana - primeiro.getUTCDay() + 7) % 7;
  return somarDiasIso(isoDe(ano, mes, 1), avanco + (n - 1) * 7);
}

/** Black Friday: a sexta depois da 4ª quinta de novembro (Ação de Graças nos EUA). */
export const blackFriday = (ano: number) => somarDiasIso(nEsimoDiaDaSemana(ano, 11, 4, 4), 1);
export const carnaval = (ano: number) => somarDiasIso(pascoa(ano), -47);
export const diaDasMaes = (ano: number) => nEsimoDiaDaSemana(ano, 5, 0, 2);
export const diaDosPais = (ano: number) => nEsimoDiaDaSemana(ano, 8, 0, 2);
/** Dia do Programador: o 256º dia do ano (13/09; 12/09 em ano bissexto). */
export const diaDoProgramador = (ano: number) => somarDiasIso(isoDe(ano, 1, 1), 255);

function fimDoMes(ano: number, mes: number): string {
  const d = comoData(isoDe(ano, mes, 1));
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ a lista fixa

const profissao = (id: string, titulo: string, dia: number, mes: number, quem: string): Definicao => ({
  id,
  titulo,
  tipo: "profissao",
  regra: { dia, mes },
  aquece: 7,
  porQue: `Data da profissão: ${quem} celebram e compartilham o que se publica sobre ela.`,
  comoUsar: `Homenagem com bastidor real (a equipe, um cliente da área) e uma oferta ou conteúdo útil para ${quem}.`,
});

const gastronomia = (id: string, titulo: string, regra: Regra, item: string): Definicao => ({
  id,
  titulo,
  tipo: "gastronomia",
  regra,
  aquece: 5,
  porQue: `Data que viraliza em perfis de comida e em promoções de ${item}.`,
  comoUsar: `Combo, degustação ou bastidor do preparo de ${item}, com prazo curto.`,
});

/** A lista versionada. Mude aqui (com teste) para acrescentar uma data. */
export const DEFINICOES_DO_HYPE: readonly Definicao[] = [
  // Varejo
  { id: "black-friday", titulo: "Black Friday", tipo: "varejo", regra: { calcular: blackFriday }, aquece: 30, depois: 3, porQue: "A maior data de descontos do varejo no Brasil; o público pesquisa preço semanas antes.", comoUsar: "Lista de espera, contagem regressiva e oferta clara com prazo; a Cyber Monday (segunda seguinte) recupera quem perdeu." },
  { id: "natal", titulo: "Natal", tipo: "varejo", regra: { dia: 25, mes: 12 }, aquece: 35, depois: 1, porQue: "O maior período de presentes e confraternizações do ano.", comoUsar: "Guia de presentes por faixa de preço, prazo de entrega e horário especial." },
  { id: "ano-novo", titulo: "Ano-Novo", tipo: "cultural", regra: { dia: 31, mes: 12 }, aquece: 10, depois: 1, porQue: "Fim de ano e metas: o público está aberto a recomeços.", comoUsar: "Retrospectiva do ano e convite para começar o próximo com a marca." },
  { id: "dia-das-maes", titulo: "Dia das Mães", tipo: "varejo", regra: { calcular: diaDasMaes }, aquece: 21, porQue: "Segunda maior data do varejo no Brasil (2º domingo de maio).", comoUsar: "Presente pronto, história real de mãe cliente e prazo de entrega." },
  { id: "dia-dos-pais", titulo: "Dia dos Pais", tipo: "varejo", regra: { calcular: diaDosPais }, aquece: 21, porQue: "Data forte de presentes no 2º semestre (2º domingo de agosto).", comoUsar: "Sugestões por perfil de pai e kit com preço fechado." },
  { id: "dia-dos-namorados", titulo: "Dia dos Namorados", tipo: "varejo", regra: { dia: 12, mes: 6 }, aquece: 14, porQue: "Data de presentes e experiências a dois.", comoUsar: "Experiência ou kit para casal, com reserva antecipada." },
  { id: "dia-das-criancas", titulo: "Dia das Crianças", tipo: "varejo", regra: { dia: 12, mes: 10 }, aquece: 21, porQue: "Data de presentes e programas em família (também feriado de N. Sra. Aparecida).", comoUsar: "Ação para a família, brinde ou atividade para a criança." },
  { id: "dia-do-consumidor", titulo: "Dia do Consumidor", tipo: "varejo", regra: { dia: 15, mes: 3 }, aquece: 7, depois: 3, porQue: "A semana do consumidor movimenta ofertas num mês sem grandes datas.", comoUsar: "Oferta de uma semana e conteúdo sobre direitos e garantias do cliente." },
  { id: "dia-do-cliente", titulo: "Dia do Cliente", tipo: "varejo", regra: { dia: 15, mes: 9 }, aquece: 7, porQue: "Data para agradecer e fidelizar quem já compra.", comoUsar: "Agradecimento com depoimento real e um mimo ou condição só para clientes." },
  { id: "dia-dos-solteiros", titulo: "11.11 (Dia dos Solteiros)", tipo: "varejo", regra: { dia: 11, mes: 11 }, aquece: 7, porQue: "Data de descontos do e-commerce que aquece a Black Friday.", comoUsar: "Prévia da oferta da Black Friday para a lista de espera." },
  { id: "volta-as-aulas", titulo: "Volta às aulas", tipo: "varejo", regra: { calcular: (ano) => nEsimoDiaDaSemana(ano, 2, 1, 1) }, aquece: 21, depois: 7, porQue: "Famílias reorganizam rotina e gastos no início do ano letivo.", comoUsar: "Checklist da volta, rotina e condição para começar o ano." },
  { id: "pascoa", titulo: "Páscoa", tipo: "varejo", regra: { calcular: pascoa }, aquece: 21, porQue: "Chocolates, presentes e encontros em família.", comoUsar: "Encomenda antecipada, kit ou ação temática com prazo." },
  // Cultura e feriados
  { id: "carnaval", titulo: "Carnaval", tipo: "cultural", regra: { calcular: carnaval }, aquece: 14, depois: 1, porQue: "O feriado mais esperado: viagens, festa e pausa na rotina.", comoUsar: "Humor leve, horário de funcionamento e o 'depois do Carnaval'." },
  { id: "dia-da-mulher", titulo: "Dia Internacional da Mulher", tipo: "cultural", regra: { dia: 8, mes: 3 }, aquece: 7, porQue: "Data de reconhecimento; pede cuidado no tom (nada de clichê de flores e desconto).", comoUsar: "Histórias reais de mulheres da equipe ou clientes." },
  { id: "dia-do-trabalhador", titulo: "Dia do Trabalhador", tipo: "cultural", regra: { dia: 1, mes: 5 }, aquece: 3, porQue: "Feriado nacional e tema de valorização do trabalho.", comoUsar: "Bastidor da equipe e horário do feriado." },
  { id: "meio-ambiente", titulo: "Dia Mundial do Meio Ambiente", tipo: "cultural", regra: { dia: 5, mes: 6 }, aquece: 5, porQue: "Data de sustentabilidade com muita busca e imprensa.", comoUsar: "Uma prática real da marca (sem promessa vazia)." },
  { id: "festa-junina", titulo: "Festa Junina", tipo: "cultural", regra: { mesInteiro: 6 }, aquece: 10, porQue: "Mês das festas juninas: comida típica, decoração e encontros.", comoUsar: "Ação temática, decoração ou produto da época." },
  { id: "dia-do-amigo", titulo: "Dia do Amigo", tipo: "cultural", regra: { dia: 20, mes: 7 }, aquece: 5, porQue: "Data de marcar amigos nos comentários: alcance orgânico.", comoUsar: "Post para marcar alguém e condição para ir em dupla." },
  { id: "dia-dos-avos", titulo: "Dia dos Avós", tipo: "cultural", regra: { dia: 26, mes: 7 }, aquece: 5, porQue: "Data afetiva que rende histórias de família.", comoUsar: "História real de cliente com os avós." },
  { id: "independencia", titulo: "Independência do Brasil", tipo: "cultural", regra: { dia: 7, mes: 9 }, aquece: 3, porQue: "Feriado nacional, às vezes prolongado.", comoUsar: "Horário do feriado e conteúdo leve sobre produto nacional." },
  { id: "dia-dos-animais", titulo: "Dia dos Animais", tipo: "cultural", regra: { dia: 4, mes: 10 }, aquece: 5, porQue: "Data forte em perfis de pet e de causa animal.", comoUsar: "Fotos reais dos pets de clientes ou da equipe." },
  { id: "halloween", titulo: "Halloween", tipo: "cultural", regra: { dia: 31, mes: 10 }, aquece: 10, porQue: "Data de fantasia e humor, cada vez maior nas redes do Brasil.", comoUsar: "Trend divertida ou produto 'assustador' da casa." },
  { id: "consciencia-negra", titulo: "Dia da Consciência Negra", tipo: "cultural", regra: { dia: 20, mes: 11 }, aquece: 5, porQue: "Feriado nacional; pede tom respeitoso e sem oportunismo.", comoUsar: "Dar voz a pessoas reais; sem oferta atrelada." },
  // Meses temáticos
  { id: "janeiro-branco", titulo: "Janeiro Branco", tipo: "consciencia", regra: { mesInteiro: 1 }, aquece: 7, porQue: "Mês da saúde mental, com muita busca no começo do ano.", comoUsar: "Conteúdo de cuidado e rotina, sem promessa clínica." },
  { id: "setembro-amarelo", titulo: "Setembro Amarelo", tipo: "consciencia", regra: { mesInteiro: 9 }, aquece: 7, porQue: "Prevenção ao suicídio: tema sério, exige cuidado e o CVV (188).", comoUsar: "Só com tom de cuidado; nada de venda." },
  { id: "outubro-rosa", titulo: "Outubro Rosa", tipo: "consciencia", regra: { mesInteiro: 10 }, aquece: 7, porQue: "Prevenção do câncer de mama, adesão grande de marcas.", comoUsar: "Lembrete do exame e ação real (doação, parceria)." },
  { id: "novembro-azul", titulo: "Novembro Azul", tipo: "consciencia", regra: { mesInteiro: 11 }, aquece: 7, porQue: "Saúde do homem e prevenção do câncer de próstata.", comoUsar: "Lembrete do check-up com linguagem direta." },
  // Profissões
  profissao("dia-do-fotografo", "Dia do Fotógrafo", 8, 1, "fotógrafos"),
  profissao("dia-do-farmaceutico", "Dia do Farmacêutico", 20, 1, "farmacêuticos"),
  profissao("dia-do-publicitario", "Dia do Publicitário", 1, 2, "publicitários"),
  profissao("dia-do-enfermeiro", "Dia do Enfermeiro", 12, 5, "enfermeiros"),
  profissao("dia-do-advogado", "Dia do Advogado", 11, 8, "advogados"),
  profissao("dia-do-psicologo", "Dia do Psicólogo", 27, 8, "psicólogos"),
  profissao("dia-do-corretor", "Dia do Corretor de Imóveis", 27, 8, "corretores de imóveis"),
  profissao("dia-do-nutricionista", "Dia do Nutricionista", 31, 8, "nutricionistas"),
  profissao("dia-do-educador-fisico", "Dia do Profissional de Educação Física", 1, 9, "profissionais de educação física"),
  profissao("dia-do-veterinario", "Dia do Médico Veterinário", 9, 9, "veterinários"),
  { ...profissao("dia-do-programador", "Dia do Programador", 13, 9, "programadores"), regra: { calcular: diaDoProgramador } },
  profissao("dia-do-contador", "Dia do Contador", 22, 9, "contadores"),
  profissao("dia-do-empreendedor", "Dia do Empreendedor", 5, 10, "empreendedores"),
  profissao("dia-do-fisioterapeuta", "Dia do Fisioterapeuta", 13, 10, "fisioterapeutas"),
  profissao("dia-do-professor", "Dia do Professor", 15, 10, "professores"),
  profissao("dia-do-medico", "Dia do Médico", 18, 10, "médicos"),
  profissao("dia-do-dentista", "Dia do Dentista", 25, 10, "dentistas"),
  profissao("dia-do-designer", "Dia do Designer", 5, 11, "designers"),
  profissao("dia-do-engenheiro", "Dia do Engenheiro", 11, 12, "engenheiros"),
  profissao("dia-do-arquiteto", "Dia do Arquiteto", 15, 12, "arquitetos"),
  profissao("dia-do-mecanico", "Dia do Mecânico", 20, 12, "mecânicos"),
  // Gastronomia
  gastronomia("dia-do-cafe", "Dia Nacional do Café", { dia: 24, mes: 5 }, "café"),
  gastronomia("dia-do-hamburguer", "Dia do Hambúrguer", { dia: 28, mes: 5 }, "hambúrguer"),
  gastronomia("dia-do-chocolate", "Dia do Chocolate", { dia: 7, mes: 7 }, "chocolate"),
  gastronomia("dia-da-pizza", "Dia da Pizza", { dia: 10, mes: 7 }, "pizza"),
  gastronomia("dia-da-cerveja", "Dia Internacional da Cerveja", { calcular: (ano) => nEsimoDiaDaSemana(ano, 8, 5, 1) }, "cerveja"),
  gastronomia("dia-do-sorvete", "Dia do Sorvete", { dia: 23, mes: 9 }, "sorvete"),
];

function janelaDe(def: Definicao, ano: number): Pick<DataDoHype, "inicio" | "pico" | "fim" | "mesInteiro"> {
  const r = def.regra;
  if ("mesInteiro" in r) {
    const pico = isoDe(ano, r.mesInteiro, 1);
    return { inicio: somarDiasIso(pico, -def.aquece), pico, fim: fimDoMes(ano, r.mesInteiro), mesInteiro: true };
  }
  const pico = "calcular" in r ? r.calcular(ano) : isoDe(ano, r.mes, r.dia);
  return { inicio: somarDiasIso(pico, -def.aquece), pico, fim: somarDiasIso(pico, def.depois || 0), mesInteiro: false };
}

/** Todas as datas de um ano, na ordem do pico. */
export function datasDoAno(ano: number): DataDoHype[] {
  return DEFINICOES_DO_HYPE.map((d) => ({ id: d.id, titulo: d.titulo, tipo: d.tipo, porQue: d.porQue, comoUsar: d.comoUsar, ...janelaDe(d, ano) }))
    .sort((a, b) => (a.pico < b.pico ? -1 : a.pico > b.pico ? 1 : a.titulo.localeCompare(b.titulo, "pt-BR")));
}

/**
 * As datas cuja janela toca as próximas `semanas` (a partir da segunda desta semana): ainda não acabou
 * (fim >= hoje) e começa a aquecer até o fim da faixa. O mês temático em andamento fica. Ordem do pico.
 */
export function datasDasProximasSemanas(hoje: string, semanas = 8): DataDoHype[] {
  const ano = Number(hoje.slice(0, 4));
  const faixa = faixaDaLinha(hoje, semanas);
  const vistas: Record<string, true> = {};
  return datasDoAno(ano - 1).concat(datasDoAno(ano), datasDoAno(ano + 1))
    .filter((d) => d.fim >= hoje && d.inicio <= faixa.fim)
    .filter((d) => {
      // Uma ocorrência por data (a mais próxima): Ano-Novo do ano passado não volta.
      if (vistas[d.id]) return false;
      vistas[d.id] = true;
      return true;
    });
}

// ------------------------------------------------------------------ linha do tempo

export interface FaixaDaLinha {
  inicio: string;
  fim: string;
  dias: number;
  semanas: { inicio: string; rotulo: string }[];
}

const curta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** As `semanas` semanas da linha do tempo, de segunda a domingo. */
export function faixaDaLinha(hoje: string, semanas = 8): FaixaDaLinha {
  const inicio = segundaDe(hoje);
  const dias = semanas * 7;
  return {
    inicio,
    fim: somarDiasIso(inicio, dias - 1),
    dias,
    semanas: Array.from({ length: semanas }).map((_, i) => {
      const s = somarDiasIso(inicio, i * 7);
      return { inicio: s, rotulo: curta(s) };
    }),
  };
}

/** Posição da barra e do pico na linha, em % (0 a 100). Pico null quando fica fora da faixa. */
export function posicaoNaLinha(d: Pick<DataDoHype, "inicio" | "pico" | "fim">, faixa: FaixaDaLinha) {
  const de = d.inicio < faixa.inicio ? faixa.inicio : d.inicio;
  const ate = d.fim > faixa.fim ? faixa.fim : d.fim;
  const pct = (iso: string) => Math.max(0, Math.min(100, (diasEntre(faixa.inicio, iso) / faixa.dias) * 100));
  const esquerda = pct(de);
  const largura = Math.max(pct(ate) + 100 / faixa.dias - esquerda, 100 / faixa.dias);
  const pico = d.pico >= faixa.inicio && d.pico <= faixa.fim ? pct(d.pico) + 50 / faixa.dias : null;
  return { esquerda, largura: Math.min(largura, 100 - esquerda), pico };
}

/** "aquece 28/10 · pico 27/11 · até 30/11"; mês temático: "o mês todo · 01/10 a 31/10". */
export function quandoDaData(d: Pick<DataDoHype, "inicio" | "pico" | "fim" | "mesInteiro">): string {
  if (d.mesInteiro) return `o mês todo · ${curta(d.pico)} a ${curta(d.fim)}`;
  const partes = [`aquece ${curta(d.inicio)}`, `pico ${curta(d.pico)}`];
  if (d.fim !== d.pico) partes.push(`até ${curta(d.fim)}`);
  return partes.join(" · ");
}

/** Quantos dias faltam para o pico (0 = hoje; negativo = já passou, ainda dentro da janela). */
export const diasAtePico = (d: Pick<DataDoHype, "pico">, hoje: string) => diasEntre(hoje, d.pico);

export function rotuloDoFalta(dias: number): string {
  if (dias === 0) return "é hoje";
  if (dias === 1) return "amanhã";
  if (dias < 0) return "em andamento";
  return `em ${dias} dias`;
}
