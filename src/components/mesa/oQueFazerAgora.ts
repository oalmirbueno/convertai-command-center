/**
 * Topo do Mês (21/10/2026, dono: "mais intuitivo, alinhado com cada nicho, e inteligente"): o resumo de uma linha
 * e o "O que fazer agora" (até 3 sugestões), montados SÓ com o que já existe na tela: o calendário fixo do nicho
 * (Datas, com a nota do Jev já guardada da semana), a leitura semanal (Da semana), as notícias já buscadas
 * (Em alta) e a agenda do mês (Calendário). Nada de chamada nova nem texto inventado: cada sugestão diz a fonte.
 * Puro (sem rede), para testar.
 */
import { diasEntre, seloDaData, somarDiasIso, segundaDe, type DataDoHype } from "./datasDoHype";
import { misturaDoMes } from "../../../supabase/functions/agente-calendario/modulos/mistura-do-nicho";

export type FonteDaSugestao = "datas" | "em-alta" | "semana" | "calendario";
export type AcaoDaSugestao = "campanha" | "abrir-em-alta" | "abrir-semana" | "agente" | "mistura";

export interface SugestaoDoMes {
  chave: string;
  texto: string;
  fonte: FonteDaSugestao;
  acao: AcaoDaSugestao;
  /** Nome da ação (aria-label e title do ícone). */
  rotuloDaAcao: string;
  /** Só na de Datas: a data que vira a campanha. */
  data?: DataDoHype;
}

export const ROTULO_DA_FONTE: Record<FonteDaSugestao, string> = {
  datas: "Datas",
  "em-alta": "Em alta",
  semana: "Da semana",
  calendario: "Calendário",
};

const curta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** A data do nicho mais urgente: aquecendo ou no pico agora; senão, a que começa a aquecer em até 7 dias. */
export function sugestaoDasDatas(principais: DataDoHype[], hoje: string): SugestaoDoMes | null {
  const naJanela = principais.filter((d) => seloDaData(d, hoje) !== null && !(d.mesInteiro && d.pico < hoje));
  const futuras = principais.filter((d) => d.inicio > hoje && diasEntre(hoje, d.inicio) <= 7).sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
  const d = naJanela.sort((a, b) => (a.pico < b.pico ? -1 : 1))[0] || futuras[0];
  if (!d) return null;
  const selo = seloDaData(d, hoje);
  const faltaInicio = diasEntre(hoje, d.inicio);
  const texto = selo === "agora"
    ? `${d.titulo} está no pico (até ${curta(d.fim)}): aproveite agora`
    : selo === "aqueca"
      ? `${d.titulo} já está aquecendo (pico ${curta(d.pico)}): crie a campanha`
      : `${d.titulo} aquece em ${faltaInicio} ${faltaInicio === 1 ? "dia" : "dias"}: crie a campanha`;
  return { chave: `datas:${d.id}`, texto, fonte: "datas", acao: "campanha", rotuloDaAcao: `Criar campanha de ${d.titulo}`, data: d };
}

/** Dias úteis sem post: a próxima semana (mês atual) ou a 1ª semana do mês (mês futuro), só dentro do mês. */
export function diasSemPost(datasComPost: Array<string | null>, mes: string, hoje: string): string[] {
  const doMes = mes.slice(0, 7);
  if (doMes < hoje.slice(0, 7)) return [];
  const inicio = doMes === hoje.slice(0, 7) ? somarDiasIso(segundaDe(hoje), 7) : segundaDe(somarDiasIso(`${doMes}-01`, 6));
  const ocupados: Record<string, true> = {};
  datasComPost.forEach((d) => { if (d) ocupados[d.slice(0, 10)] = true; });
  const saida: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const dia = somarDiasIso(inicio, i);
    if (dia.slice(0, 7) !== doMes) continue;
    if (!ocupados[dia]) saida.push(dia);
  }
  return saida;
}

export function sugestoesDoMes(e: {
  hoje: string;
  mes: string;
  principais: DataDoHype[];
  noticiasQueServem: number | null;
  emAltaNoNicho: number;
  leituraDaSemana: boolean;
  datasComPost: Array<string | null> | null;
  /** 23/10: as peças do mês (título e formato) para ver se ficou num formato só. */
  pecas?: Array<{ title: string; delivery_type: string | null; due_date?: string | null }> | null;
}): SugestaoDoMes[] {
  const saida: SugestaoDoMes[] = [];
  // 23/10 (dono: "diversificar e mesclar; ele já dá a sugestão para eu aprovar"): mês repetitivo vem primeiro.
  if (e.pecas && e.mes.slice(0, 7) >= e.hoje.slice(0, 7)) {
    const leitura = misturaDoMes(e.pecas);
    if (leitura.repetitivo) {
      saida.push({ chave: "mistura", texto: `Mês repetitivo: ${leitura.frase}. Misturar com vídeo e foto pelo nicho`, fonte: "calendario", acao: "mistura", rotuloDaAcao: "Sugerir a mistura de formatos (você confirma)" });
    }
  }
  const dat = sugestaoDasDatas(e.principais, e.hoje);
  if (dat) saida.push(dat);
  if (e.noticiasQueServem && e.noticiasQueServem > 0) {
    saida.push({ chave: "em-alta", texto: `${e.noticiasQueServem} ${e.noticiasQueServem === 1 ? "notícia do nicho serve" : "notícias do nicho servem"} agora`, fonte: "em-alta", acao: "abrir-em-alta", rotuloDaAcao: "Ver as notícias em Em alta" });
  } else if (e.emAltaNoNicho > 0) {
    saida.push({ chave: "semana", texto: `${e.emAltaNoNicho} ${e.emAltaNoNicho === 1 ? "assunto em alta" : "assuntos em alta"} no nicho esta semana`, fonte: "semana", acao: "abrir-semana", rotuloDaAcao: "Ver na Da semana" });
  } else if (!e.leituraDaSemana) {
    saida.push({ chave: "semana", texto: "Sem a leitura do nicho desta semana: busque o que está em alta", fonte: "semana", acao: "abrir-semana", rotuloDaAcao: "Abrir o Radar" });
  }
  if (e.datasComPost) {
    const livres = diasSemPost(e.datasComPost, e.mes, e.hoje);
    if (livres.length >= 2) {
      const quando = e.mes.slice(0, 7) === e.hoje.slice(0, 7) ? "na próxima semana" : "na 1ª semana do mês";
      saida.push({ chave: "calendario", texto: `${livres.length} dias úteis sem post ${quando}`, fonte: "calendario", acao: "agente", rotuloDaAcao: "Preencher com o Agente do mês" });
    }
  }
  return saida.slice(0, 3);
}

/** "12 posts planejados · 3 datas no radar · 5 em alta no nicho" (só o que tem número). */
export function resumoDoMes(r: { posts: number | null; datas: number; emAlta: number }): string {
  return [
    r.posts === null ? "" : `${r.posts} ${r.posts === 1 ? "post planejado" : "posts planejados"}`,
    `${r.datas} ${r.datas === 1 ? "data" : "datas"} no radar`,
    r.emAlta ? `${r.emAlta} em alta no nicho` : "",
  ].filter(Boolean).join(" · ");
}

/** O nicho em poucas palavras: o segmento do cadastro; sem ele, o começo do "negócio" do contexto. */
export function nichoCurto(segmento: string | null | undefined, negocio: string | null | undefined): string {
  const s = String(segmento || "").trim();
  if (s) return s.slice(0, 40);
  const n = String(negocio || "").split(/[.;,\n]/)[0].trim();
  return n.split(" ").filter(Boolean).slice(0, 4).join(" ").slice(0, 40);
}
