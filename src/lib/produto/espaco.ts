import { supabase } from "@/integrations/supabase/client";

/**
 * Espaço do CRM: as páginas da empresa (playbook de vendas, roteiros,
 * treinamento, atas), uma dentro da outra, no estilo de um caderno
 * compartilhado. Tabela `crm_paginas`
 * (supabase/migrations/20261113220000_crm_espaco.sql).
 *
 * Quem vê: `todos` (a empresa inteira), `gestores` (admin e gerente) ou `eu`
 * (só quem criou). Quem edita: quem criou, ou um gestor nas páginas que ele vê.
 * O banco é quem garante; as funções daqui só evitam oferecer o que ele vai negar.
 *
 * A parte de cima do arquivo é pura (árvore, permissões, modelos) e tem teste
 * em src/test/produto-espaco.test.ts. A de baixo fala com o banco.
 */

const db = supabase as unknown as { from: (t: string) => any };

// --------------------------------------------------------------------------
// Tipos
// --------------------------------------------------------------------------

export type VisivelPara = "todos" | "gestores" | "eu";

/** Um nó do documento do editor (formato do TipTap/ProseMirror). */
export interface NoDoEditor {
  type: string;
  attrs?: Record<string, unknown>;
  content?: NoDoEditor[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface DocDoEditor extends NoDoEditor {
  type: "doc";
  content: NoDoEditor[];
}

/** A página sem o conteúdo: é o que a árvore precisa. */
export interface PaginaDoEspaco {
  id: string;
  conta_id: string;
  pai_id: string | null;
  titulo: string;
  icone: string | null;
  visivel_para: VisivelPara;
  ordem: number;
  /** Sobe a cada gravação. A tela grava dizendo qual versão leu. */
  versao: number;
  criado_por: string | null;
  atualizado_por: string | null;
  criado_em: string;
  atualizado_em: string;
  arquivada_em: string | null;
}

export interface PaginaCompleta extends PaginaDoEspaco {
  conteudo: DocDoEditor;
}

export interface NoDaArvore {
  pagina: PaginaDoEspaco;
  filhos: NoDaArvore[];
  /** 0 para as páginas de cima. */
  nivel: number;
}

/** Quem está olhando: o id do login e o cargo na empresa. */
export interface QuemOlha {
  userId: string | null | undefined;
  papel: string | null | undefined;
}

export const LIMITE_DE_PAGINAS = 500;
export const LIMITE_DO_TITULO = 160;
export const LIMITE_DO_ICONE = 16;
/** O banco aceita 400 mil bytes do documento já formatado por ele; a tela para antes, com folga. */
export const LIMITE_DO_CONTEUDO = 300000;
export const NIVEIS_NO_MAXIMO = 10;

export const ROTULO_DE_QUEM_VE: Record<VisivelPara, string> = {
  todos: "Toda a equipe",
  gestores: "Só gestores",
  eu: "Só eu",
};

export const AJUDA_DE_QUEM_VE: Record<VisivelPara, string> = {
  todos: "Todo mundo da empresa lê",
  gestores: "Só quem administra e os gerentes leem",
  eu: "Só você lê",
};

// --------------------------------------------------------------------------
// Permissões (o banco repete tudo isto nas políticas)
// --------------------------------------------------------------------------

/** Admin ou gerente. */
export const ehGestor = (papel: string | null | undefined) => papel === "admin" || papel === "gerente";

/** Edita quem criou, ou um gestor quando a página não é particular de outra pessoa. */
export function podeEditar(pagina: Pick<PaginaDoEspaco, "criado_por" | "visivel_para">, quem: QuemOlha): boolean {
  if (!quem.userId) return false;
  if (pagina.criado_por && pagina.criado_por === quem.userId) return true;
  return ehGestor(quem.papel) && pagina.visivel_para !== "eu";
}

/**
 * As opções de "quem vê" que esta pessoa pode escolher nesta página.
 * Sem página (criando): a pessoa é a autora.
 */
export function visibilidadesPermitidas(pagina: Pick<PaginaDoEspaco, "criado_por" | "visivel_para"> | null, quem: QuemOlha): VisivelPara[] {
  const autor = !pagina || (!!quem.userId && pagina.criado_por === quem.userId);
  const gestor = ehGestor(quem.papel);
  if (pagina && !podeEditar(pagina, quem)) return [];
  const opcoes: VisivelPara[] = ["todos"];
  if (gestor) opcoes.push("gestores");
  if (autor) opcoes.push("eu");
  return opcoes;
}

// --------------------------------------------------------------------------
// Árvore
// --------------------------------------------------------------------------

/** O título para mostrar (página sem título ainda aparece na lista). */
export const tituloDaPagina = (p: Pick<PaginaDoEspaco, "titulo"> | null | undefined) => {
  const t = p && typeof p.titulo === "string" ? p.titulo.trim() : "";
  return t || "Sem título";
};

const porOrdem = (a: PaginaDoEspaco, b: PaginaDoEspaco) => {
  if (a.ordem !== b.ordem) return a.ordem - b.ordem;
  if (a.criado_em !== b.criado_em) return a.criado_em < b.criado_em ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

function indice(paginas: PaginaDoEspaco[]): Record<string, PaginaDoEspaco> {
  const mapa: Record<string, PaginaDoEspaco> = {};
  paginas.forEach((p) => {
    mapa[p.id] = p;
  });
  return mapa;
}

/** A página está arquivada, ou está dentro de uma arquivada. */
export function estaArquivada(paginas: PaginaDoEspaco[], id: string): boolean {
  const mapa = indice(paginas);
  let atual: PaginaDoEspaco | undefined = mapa[id];
  let passos = 0;
  while (atual && passos <= paginas.length) {
    if (atual.arquivada_em) return true;
    atual = atual.pai_id ? mapa[atual.pai_id] : undefined;
    passos += 1;
  }
  return false;
}

/**
 * Monta a árvore das páginas ativas.
 * - Página arquivada some, com tudo o que está dentro dela.
 * - Página cujo pai a pessoa não enxerga (não veio na lista) sobe para o topo: nada fica perdido.
 * - Irmãs em ordem de `ordem`, depois da mais antiga para a mais nova.
 * - Um círculo (que o banco não deixa gravar) não trava a tela: cada página entra uma vez só.
 */
export function montarArvore(paginas: PaginaDoEspaco[]): NoDaArvore[] {
  const mapa = indice(paginas);
  const ativas = paginas.filter((p) => !estaArquivada(paginas, p.id));
  const filhosDe: Record<string, PaginaDoEspaco[]> = {};
  const topo: PaginaDoEspaco[] = [];
  ativas.forEach((p) => {
    if (p.pai_id && mapa[p.pai_id] && p.pai_id !== p.id) {
      (filhosDe[p.pai_id] = filhosDe[p.pai_id] || []).push(p);
    } else {
      topo.push(p);
    }
  });
  const postas: Record<string, boolean> = {};
  const montar = (p: PaginaDoEspaco, nivel: number): NoDaArvore => {
    postas[p.id] = true;
    const filhos = (filhosDe[p.id] || [])
      .slice()
      .sort(porOrdem)
      .filter((f) => !postas[f.id])
      .map((f) => montar(f, nivel + 1));
    return { pagina: p, filhos, nivel };
  };
  const arvore = topo.slice().sort(porOrdem).map((p) => montar(p, 0));
  // O que sobrou só sobra se houver círculo: entra no topo para não sumir.
  ativas
    .slice()
    .sort(porOrdem)
    .forEach((p) => {
      if (!postas[p.id]) arvore.push(montar(p, 0));
    });
  return arvore;
}

/** A árvore em lista, de cima para baixo, pulando o que está dentro de uma página recolhida. */
export function achatarArvore(arvore: NoDaArvore[], recolhidas: string[] = []): NoDaArvore[] {
  const saida: NoDaArvore[] = [];
  const andar = (nos: NoDaArvore[]) => {
    nos.forEach((n) => {
      saida.push(n);
      if (recolhidas.indexOf(n.pagina.id) < 0) andar(n.filhos);
    });
  };
  andar(arvore);
  return saida;
}

/** Do topo até a página (ela por último). Para no pai que a pessoa não enxerga. */
export function trilhaDaPagina(paginas: PaginaDoEspaco[], id: string): PaginaDoEspaco[] {
  const mapa = indice(paginas);
  const trilha: PaginaDoEspaco[] = [];
  const vistas: Record<string, boolean> = {};
  let atual: PaginaDoEspaco | undefined = mapa[id];
  while (atual && !vistas[atual.id]) {
    vistas[atual.id] = true;
    trilha.unshift(atual);
    atual = atual.pai_id ? mapa[atual.pai_id] : undefined;
  }
  return trilha;
}

/** Os ids de tudo o que está dentro da página, em qualquer nível. */
export function descendentesDe(paginas: PaginaDoEspaco[], id: string): string[] {
  const saida: string[] = [];
  const vistas: Record<string, boolean> = { [id]: true };
  let fila = [id];
  while (fila.length) {
    const proxima: string[] = [];
    paginas.forEach((p) => {
      if (p.pai_id && fila.indexOf(p.pai_id) >= 0 && !vistas[p.id]) {
        vistas[p.id] = true;
        saida.push(p.id);
        proxima.push(p.id);
      }
    });
    fila = proxima;
  }
  return saida;
}

/** Quantos níveis há da página para baixo (1 = ela sozinha). */
function alturaDe(paginas: PaginaDoEspaco[], id: string): number {
  let altura = 1;
  let fila = [id];
  const vistas: Record<string, boolean> = { [id]: true };
  while (fila.length) {
    const proxima = paginas.filter((p) => p.pai_id && fila.indexOf(p.pai_id) >= 0 && !vistas[p.id]).map((p) => p.id);
    proxima.forEach((x) => {
      vistas[x] = true;
    });
    if (proxima.length) altura += 1;
    fila = proxima;
  }
  return altura;
}

/**
 * Pode mover a página para dentro de `destino` (nulo = topo)? Não entra nela
 * mesma, nem em algo que está dentro dela, nem passa de 10 níveis.
 */
export function podeMoverPara(paginas: PaginaDoEspaco[], id: string, destino: string | null): boolean {
  if (destino === null) return true;
  if (destino === id) return false;
  const mapa = indice(paginas);
  if (!mapa[destino] || estaArquivada(paginas, destino)) return false;
  if (descendentesDe(paginas, id).indexOf(destino) >= 0) return false;
  return trilhaDaPagina(paginas, destino).length + alturaDe(paginas, id) <= NIVEIS_NO_MAXIMO;
}

/** As páginas onde esta pode entrar, na ordem da árvore (com o nível, para o recuo). */
export function destinosParaMover(paginas: PaginaDoEspaco[], id: string): NoDaArvore[] {
  return achatarArvore(montarArvore(paginas)).filter((n) => podeMoverPara(paginas, id, n.pagina.id));
}

/** A ordem de uma página nova dentro de `paiId`: depois da última. */
export function proximaOrdem(paginas: PaginaDoEspaco[], paiId: string | null): number {
  let maior = 0;
  paginas.forEach((p) => {
    if ((p.pai_id || null) === (paiId || null) && p.ordem > maior) maior = p.ordem;
  });
  return maior + 1;
}

/** As páginas arquivadas (a de cima de cada grupo: restaurar traz o que está dentro). */
export function paginasArquivadas(paginas: PaginaDoEspaco[]): PaginaDoEspaco[] {
  return paginas
    .filter((p) => !!p.arquivada_em)
    .sort((a, b) => ((a.arquivada_em || "") < (b.arquivada_em || "") ? 1 : -1));
}

// --------------------------------------------------------------------------
// Documento do editor
// --------------------------------------------------------------------------

export const docVazio = (): DocDoEditor => ({ type: "doc", content: [{ type: "paragraph" }] });

/** O que veio do banco vira um documento válido (ou um vazio). */
export function lerDoc(v: unknown): DocDoEditor {
  const o = v && typeof v === "object" ? (v as { type?: unknown; content?: unknown }) : null;
  if (o && o.type === "doc" && Array.isArray(o.content) && o.content.length > 0) return v as DocDoEditor;
  return docVazio();
}

/** O texto corrido do documento (busca, resumo, teste). */
export function textoDoDoc(doc: NoDoEditor | null | undefined): string {
  if (!doc) return "";
  if (typeof doc.text === "string") return doc.text;
  return (doc.content || []).map(textoDoDoc).filter((t) => t !== "").join(" ");
}

export function bytesDoDoc(doc: unknown): number {
  const s = JSON.stringify(doc || {});
  try {
    return new TextEncoder().encode(s).length;
  } catch {
    return s.length * 2;
  }
}

export const cabeNoTeto = (doc: unknown) => bytesDoDoc(doc) <= LIMITE_DO_CONTEUDO;

/** Só endereço que abre em outra aba sem risco: http, https, e-mail e telefone. Devolve nulo se não servir. */
export function linkSeguro(bruto: string): string | null {
  const v = (bruto || "").trim();
  if (!v || v.length > 2000) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  if (/^[^\s]+\.[^\s]+$/.test(v)) return `https://${v}`;
  return null;
}

// Menu de barra: digitar "/" no editor abre os tipos de bloco.
export type BlocoId = "texto" | "titulo1" | "titulo2" | "titulo3" | "lista" | "numerada" | "tarefas" | "citacao" | "codigo" | "divisor";

export interface BlocoDoMenu {
  id: BlocoId;
  nome: string;
  /** O atalho de markdown que faz o mesmo, para quem prefere digitar. */
  atalho: string;
  /** Outras palavras que a pessoa pode digitar depois da barra. */
  palavras: string[];
}

export const BLOCOS_DO_MENU: BlocoDoMenu[] = [
  { id: "texto", nome: "Texto", atalho: "", palavras: ["paragrafo", "normal"] },
  { id: "titulo1", nome: "Título 1", atalho: "#", palavras: ["h1", "titulo grande", "cabecalho"] },
  { id: "titulo2", nome: "Título 2", atalho: "##", palavras: ["h2", "titulo medio", "subtitulo"] },
  { id: "titulo3", nome: "Título 3", atalho: "###", palavras: ["h3", "titulo pequeno"] },
  { id: "lista", nome: "Lista", atalho: "-", palavras: ["marcadores", "topicos", "bullet"] },
  { id: "numerada", nome: "Lista numerada", atalho: "1.", palavras: ["numeros", "passos", "ordem"] },
  { id: "tarefas", nome: "Lista de tarefas", atalho: "[ ]", palavras: ["checklist", "caixa", "marcar", "afazeres", "todo"] },
  { id: "citacao", nome: "Citação", atalho: ">", palavras: ["fala", "roteiro", "destaque", "aspas"] },
  { id: "codigo", nome: "Código", atalho: "```", palavras: ["bloco de codigo", "pre"] },
  { id: "divisor", nome: "Divisor", atalho: "---", palavras: ["linha", "separador", "traco"] },
];

/** Minúsculas e sem acento, para comparar o que a pessoa digitou. */
export const semAcento = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Os blocos que combinam com o que veio depois da barra (começo do nome primeiro). */
export function filtrarBlocos(consulta: string): BlocoDoMenu[] {
  const q = semAcento(consulta).trim();
  if (!q) return BLOCOS_DO_MENU;
  const comeca = BLOCOS_DO_MENU.filter((bl) => semAcento(bl.nome).indexOf(q) === 0);
  const contem = BLOCOS_DO_MENU.filter((bl) => comeca.indexOf(bl) < 0 && (semAcento(bl.nome).indexOf(q) >= 0 || bl.palavras.some((w) => w.indexOf(q) >= 0)));
  return comeca.concat(contem);
}

/**
 * O que a pessoa está digitando depois de uma barra, olhando o texto do bloco
 * até o cursor. Nulo quando não há barra aberta. A barra vale no começo do
 * bloco ou depois de um espaço ("e/ou" e endereços não abrem o menu).
 */
export function consultaDaBarra(textoAteOCursor: string): string | null {
  const barra = textoAteOCursor.lastIndexOf("/");
  if (barra < 0) return null;
  if (barra > 0 && !/\s/.test(textoAteOCursor.charAt(barra - 1))) return null;
  const depois = textoAteOCursor.slice(barra + 1);
  if (depois.length > 24 || /\s\s/.test(depois) || depois.charAt(0) === " ") return null;
  return depois;
}

// Peças para escrever os modelos sem repetir o formato do editor.
const t = (texto: string, negrito = false): NoDoEditor => (negrito ? { type: "text", text: texto, marks: [{ type: "bold" }] } : { type: "text", text: texto });
type Parte = string | NoDoEditor;
const partes = (ps: Parte[]): NoDoEditor[] => ps.filter((p) => p !== "").map((p) => (typeof p === "string" ? t(p) : p));
const b = (texto: string) => t(texto, true);
const p = (...ps: Parte[]): NoDoEditor => ({ type: "paragraph", content: partes(ps) });
const h = (nivel: 1 | 2 | 3, texto: string): NoDoEditor => ({ type: "heading", attrs: { level: nivel }, content: [t(texto)] });
const item = (linha: Parte | Parte[]): NoDoEditor => ({ type: "listItem", content: [p(...(Array.isArray(linha) ? linha : [linha]))] });
const lista = (linhas: Array<Parte | Parte[]>): NoDoEditor => ({ type: "bulletList", content: linhas.map(item) });
const numerada = (linhas: Array<Parte | Parte[]>): NoDoEditor => ({ type: "orderedList", attrs: { start: 1 }, content: linhas.map(item) });
const tarefas = (linhas: string[]): NoDoEditor => ({
  type: "taskList",
  content: linhas.map((l) => ({ type: "taskItem", attrs: { checked: false }, content: [p(l)] })),
});
const citacao = (...linhas: string[]): NoDoEditor => ({ type: "blockquote", content: linhas.map((l) => p(l)) });
const divisor = (): NoDoEditor => ({ type: "horizontalRule" });
const doc = (...nos: NoDoEditor[]): DocDoEditor => ({ type: "doc", content: nos });

// --------------------------------------------------------------------------
// Modelos prontos
// --------------------------------------------------------------------------

export type ModeloId = "playbook" | "roteiro" | "objecoes" | "boas_vindas";

/** O que a tela sabe da empresa para o modelo já nascer com as palavras dela. */
export interface ContextoDoModelo {
  empresa?: string;
  nicho?: string | null;
  /** Os nomes das etapas do funil como a empresa lê (novo, contato, diagnostico...). */
  etapas?: Partial<Record<string, string>>;
}

export interface ModeloDePagina {
  id: ModeloId;
  titulo: string;
  /** Uma linha: para que serve. */
  resumo: string;
  conteudo: (contexto?: ContextoDoModelo) => DocDoEditor;
}

interface PalavrasDoRamo {
  /** Como o ramo chama quem compra. */
  cliente: string;
  /** O que se vende, numa expressão curta. */
  oferta: string;
  /** O encontro que faz o negócio andar. */
  encontro: string;
  /** Uma objeção típica do ramo, com o que está por trás e a resposta. */
  objecao: { fala: string; porTras: string; pergunta: string; resposta: string };
}

const RAMO_PADRAO: PalavrasDoRamo = {
  cliente: "cliente",
  oferta: "o que vendemos",
  encontro: "a reunião",
  objecao: {
    fala: "Já tentei algo parecido e não deu certo",
    porTras: "Medo de repetir um erro. A pessoa quer saber o que será diferente desta vez.",
    pergunta: "O que aconteceu da outra vez? O que faltou?",
    resposta: "Entendo. Pelo que você contou, o que faltou foi [ponto]. Aqui isso funciona assim: [como]. Posso mostrar um caso parecido com o seu?",
  },
};

const RAMOS: Record<string, PalavrasDoRamo> = {
  imobiliaria: {
    cliente: "cliente",
    oferta: "imóveis para compra e locação",
    encontro: "a visita ao imóvel",
    objecao: {
      fala: "Vou esperar o preço baixar",
      porTras: "Insegurança sobre o momento. Quase sempre falta comparar o custo de esperar.",
      pergunta: "Enquanto espera, você segue pagando aluguel? Quanto por mês?",
      resposta: "Faz sentido querer o melhor preço. Em 12 meses de espera você paga [valor] de aluguel, e este imóvel pode não estar mais disponível. Vamos simular a parcela para comparar com o que você paga hoje?",
    },
  },
  consorcio: {
    cliente: "cliente",
    oferta: "cartas de consórcio",
    encontro: "a simulação",
    objecao: {
      fala: "Não quero esperar para ser contemplado",
      porTras: "A pessoa compara com financiamento e só enxerga o prazo, não o custo total.",
      pergunta: "Para quando você precisa do bem? Tem algum valor para dar de lance?",
      resposta: "Entendo a pressa. Com um lance de [valor], a chance de contemplação nos primeiros meses é [dado do grupo]. E no fim você paga [diferença] a menos que no financiamento. Quer ver as duas contas lado a lado?",
    },
  },
  saude: {
    cliente: "paciente",
    oferta: "tratamentos e procedimentos",
    encontro: "a avaliação",
    objecao: {
      fala: "Vou ver se o meu convênio cobre",
      porTras: "Dúvida sobre o valor, não sobre o tratamento.",
      pergunta: "Se o convênio não cobrir, o que pesaria mais para você: o valor total ou a parcela?",
      resposta: "Claro, vale conferir. Já deixo a avaliação reservada para [dia], sem compromisso, e você decide depois de falar com o convênio. Se precisar, temos parcelamento em [condição].",
    },
  },
  servicos: {
    cliente: "cliente",
    oferta: "serviços",
    encontro: "a visita técnica",
    objecao: {
      fala: "Achei um orçamento mais barato",
      porTras: "Os orçamentos não estão sendo comparados item por item.",
      pergunta: "O outro orçamento inclui material, garantia e prazo por escrito?",
      resposta: "Vale comparar com calma. O nosso inclui [material], garantia de [prazo] e data de entrega no contrato. Se o outro tiver o mesmo, me mostra que eu vejo o que consigo fazer.",
    },
  },
  varejo: {
    cliente: "cliente",
    oferta: "produtos",
    encontro: "a demonstração",
    objecao: {
      fala: "Vi mais barato na internet",
      porTras: "A pessoa quer o menor preço, mas também quer segurança e pressa na entrega.",
      pergunta: "Lá o preço já é com frete e entrega para quando?",
      resposta: "Entendo. Aqui você leva hoje, com garantia na loja e troca sem burocracia. Somando o frete, a diferença fica em [valor]. Consigo [condição] para fechar agora.",
    },
  },
  agencia: {
    cliente: "cliente",
    oferta: "serviços de marketing",
    encontro: "a reunião de diagnóstico",
    objecao: {
      fala: "Já tive agência e não deu resultado",
      porTras: "Experiência ruim: promessa grande, pouca transparência.",
      pergunta: "O que foi combinado com a outra agência e o que não foi entregue?",
      resposta: "Entendo a desconfiança. Aqui você acompanha [números] toda semana e sabe o que foi feito. Nos primeiros 30 dias a meta é [meta realista]. Posso mostrar o relatório de um cliente do seu porte?",
    },
  },
  educacao: {
    cliente: "aluno",
    oferta: "cursos e matrículas",
    encontro: "a aula experimental",
    objecao: {
      fala: "Não vou ter tempo de estudar",
      porTras: "Medo de pagar e não aproveitar.",
      pergunta: "Quantas horas por semana você consegue separar hoje?",
      resposta: "Com [horas] por semana dá para acompanhar, e as aulas ficam gravadas. Que tal fazer a aula experimental de [dia] para sentir o ritmo antes de decidir?",
    },
  },
  b2b: {
    cliente: "cliente",
    oferta: "soluções para empresas",
    encontro: "a reunião",
    objecao: {
      fala: "Não temos verba aprovada para este ano",
      porTras: "O projeto ainda não é prioridade para quem aprova o orçamento.",
      pergunta: "Quem aprova a verba e o que essa pessoa precisa ver para priorizar?",
      resposta: "Entendo. Posso montar com você a conta do retorno em [prazo] para levar a quem aprova. Se fizer sentido, começamos com [piloto menor] e o restante entra no próximo orçamento.",
    },
  },
};

const ETAPAS_PADRAO: Array<{ id: string; nome: string; avanca: string }> = [
  { id: "novo", nome: "Novo", avanca: "primeira resposta enviada, de preferência em até 15 minutos no horário comercial" },
  { id: "contato", nome: "Em contato", avanca: "conversa aberta, a pessoa respondeu e sabemos o que ela procura" },
  { id: "diagnostico", nome: "Diagnóstico", avanca: "entendemos a necessidade, o prazo, quem decide e quanto pretende investir" },
  { id: "proposta", nome: "Proposta", avanca: "proposta enviada e data de retorno combinada com a pessoa" },
  { id: "negociacao", nome: "Negociação", avanca: "condições ajustadas e o que falta para assinar está escrito na próxima ação" },
  { id: "ganho", nome: "Ganho", avanca: "fechou: registrar o valor e passar o cliente para a entrega" },
  { id: "perdido", nome: "Perdido", avanca: "não seguiu: registrar o motivo de verdade, sem deixar em branco" },
];

const ramoDe = (contexto?: ContextoDoModelo): PalavrasDoRamo => (contexto && contexto.nicho && RAMOS[contexto.nicho]) || RAMO_PADRAO;
const empresaDe = (contexto?: ContextoDoModelo) => (contexto && contexto.empresa ? contexto.empresa.trim() : "") || "nossa empresa";

function playbook(contexto?: ContextoDoModelo): DocDoEditor {
  const ramo = ramoDe(contexto);
  const nomes = (contexto && contexto.etapas) || {};
  return doc(
    p(`Este é o jeito de vender da ${empresaDe(contexto)}. Troque os trechos entre colchetes pelas palavras da equipe. Quando a prática mudar, mude aqui: o playbook vale pelo que a equipe faz, não pelo que foi escrito uma vez.`),
    h(2, "Quem compra da gente"),
    lista([
      [b("Perfil ideal: "), `[quem é o ${ramo.cliente} que mais compra, fica e indica]`],
      [b("O problema que resolve: "), "[a dor que faz a pessoa procurar a gente]"],
      [b("Quem decide: "), "[quem dá a palavra final e quem influencia]"],
      [b("Sinais de que não é para nós: "), "[casos em que vale dizer não cedo]"],
    ]),
    h(2, "O que vendemos"),
    lista([
      [b("Oferta principal: "), `[${ramo.oferta}, com o valor médio]`],
      [b("Por que escolhem a gente: "), "[três motivos que clientes reais já disseram]"],
      [b("Prova: "), "[casos, números e depoimentos que podemos mostrar]"],
    ]),
    h(2, "Etapas do funil"),
    p("Um negócio só avança quando a condição da etapa aconteceu de verdade."),
    lista(ETAPAS_PADRAO.map((e) => [b(`${(nomes[e.id] || "").trim() || e.nome}: `), e.avanca] as Parte[])),
    h(2, "Ritmo de contato"),
    p("Quem não responde não disse não. Cinco tentativas antes de encerrar, variando o canal."),
    numerada([
      [b("Dia 1: "), "mensagem de apresentação e ligação no mesmo dia"],
      [b("Dia 2: "), "mensagem curta com uma pergunta fácil de responder"],
      [b("Dia 4: "), "ligação em outro horário e um caso parecido com o da pessoa"],
      [b("Dia 7: "), "mensagem com algo útil (dica, comparação, simulação)"],
      [b("Dia 15: "), "mensagem de encerramento, deixando a porta aberta"],
    ]),
    h(2, "Regras da casa"),
    lista([
      "Todo negócio aberto tem próxima ação com data. Sem próxima ação, o negócio está parado.",
      "Contato novo recebe resposta no mesmo dia.",
      "O que foi combinado com a pessoa fica escrito no negócio, não só no WhatsApp.",
      "Negócio perdido tem motivo registrado.",
      `Depois de ${ramo.encontro}, o retorno acontece em até 24 horas.`,
    ]),
    h(2, "Números que a equipe acompanha"),
    lista([
      [b("Contatos novos por semana: "), "[meta]"],
      [b("Tempo até a primeira resposta: "), "[meta]"],
      [b("Propostas enviadas por semana: "), "[meta]"],
      [b("Conversão de proposta em venda: "), "[meta]"],
      [b("Venda do mês por pessoa: "), "[meta]"],
    ]),
    h(2, "Rotina da semana"),
    tarefas([
      "Segunda: revisar os negócios parados e definir a próxima ação de cada um",
      "Todo dia: cumprir os compromissos de hoje antes de abrir negócio novo",
      "Quarta: retomar as propostas enviadas que ainda não tiveram resposta",
      "Sexta: conferir os números da semana e anotar o que aprendeu",
    ]),
  );
}

function roteiro(contexto?: ContextoDoModelo): DocDoEditor {
  const ramo = ramoDe(contexto);
  const empresa = empresaDe(contexto);
  return doc(
    p("Roteiro é trilho, não texto para ler em voz alta. Use as perguntas na ordem, com as suas palavras, e escute mais do que fala."),
    h(2, "Antes de falar"),
    tarefas([
      "Ler o histórico do negócio e de onde o contato veio",
      "Olhar o site ou a rede social da pessoa por dois minutos",
      "Definir o objetivo deste contato (marcar, entender ou fechar)",
      "Ter um caso parecido para contar",
    ]),
    h(2, "Abertura"),
    p("Diga quem é, por que está falando e peça licença. Trinta segundos."),
    citacao(`Oi, [nome]. Aqui é [seu nome], da ${empresa}. Vi que você [pediu informações / foi indicado por / se interessou por]. Tem dois minutos agora ou prefere que eu chame mais tarde?`),
    h(2, "Perguntas para entender"),
    numerada([
      "O que fez você procurar isso agora?",
      "Como você resolve isso hoje? O que incomoda nesse jeito?",
      "O que seria um bom resultado para você?",
      "Para quando você precisa?",
      "Além de você, quem mais participa da decisão?",
      "Você já tem uma ideia de quanto pretende investir?",
    ]),
    p(b("Dica: "), "depois de cada resposta, repita com as suas palavras o que entendeu. A pessoa corrige ou confirma, e as duas coisas ajudam."),
    h(2, "Mostrar o caminho"),
    lista([
      "Ligue o que você oferece ao que a pessoa acabou de dizer, usando as palavras dela.",
      "Conte um caso parecido em três frases: como estava, o que foi feito, como ficou.",
      "Fale de valor depois que a pessoa enxergou o resultado, nunca antes.",
    ]),
    h(2, "Fechar o próximo passo"),
    p(`Nenhum contato termina sem data combinada. O melhor próximo passo costuma ser ${ramo.encontro}.`),
    citacao("Pelo que você me contou, faz sentido [próximo passo]. Fica melhor para você [dia e hora] ou [outro dia e hora]?"),
    h(2, "Mensagens prontas"),
    h(3, "Primeiro contato"),
    citacao(`Oi, [nome], tudo bem? Aqui é [seu nome], da ${empresa}. Recebi o seu contato sobre [assunto]. Para eu te ajudar do jeito certo: o que você está buscando resolver?`),
    h(3, "Sem resposta há alguns dias"),
    citacao("Oi, [nome]. Imagino que a semana esteja corrida. Ainda faz sentido conversarmos sobre [assunto]? Se preferir, me diga um horário bom e eu te chamo."),
    h(3, "Depois da conversa"),
    citacao("[Nome], obrigado pela conversa. Combinamos: [o que ficou combinado]. Do meu lado, envio [o que você vai enviar] até [dia]. Qualquer dúvida, é só chamar."),
    h(3, "Encerramento"),
    citacao("Oi, [nome]. Como não consegui falar com você, vou encerrar por aqui para não incomodar. Se voltar a fazer sentido, é só responder esta mensagem que retomo de onde paramos."),
    h(2, "O que evitar"),
    lista([
      "Mandar preço antes de entender o que a pessoa precisa.",
      "Áudio longo no primeiro contato.",
      "Falar mal do concorrente.",
      "Prometer prazo ou resultado que não depende de você.",
      "Terminar a conversa com um 'qualquer coisa me chama'.",
    ]),
  );
}

function objecoes(contexto?: ContextoDoModelo): DocDoEditor {
  const ramo = ramoDe(contexto);
  const bloco = (fala: string, porTras: string, pergunta: string, resposta: string): NoDoEditor[] => [
    h(3, `"${fala}"`),
    p(b("O que costuma estar por trás: "), porTras),
    p(b("Pergunte: "), pergunta),
    citacao(resposta),
  ];
  return doc(
    p("Objeção é pedido de mais informação. Quem responde rápido demais parece que está empurrando. Primeiro entenda, depois responda."),
    h(2, "Como responder qualquer objeção"),
    numerada([
      [b("Escute até o fim. "), "Sem interromper e sem se defender."],
      [b("Mostre que entendeu. "), "Repita o ponto com as suas palavras."],
      [b("Pergunte. "), "Descubra o motivo de verdade antes de argumentar."],
      [b("Responda só o que foi dito. "), "Com um fato, um caso ou uma conta."],
      [b("Confirme e avance. "), "Pergunte se ficou claro e proponha o próximo passo."],
    ]),
    divisor(),
    h(2, "As mais comuns"),
    ...bloco(
      "Está caro",
      "A pessoa ainda não enxergou valor suficiente, ou está comparando com algo diferente.",
      "Caro em relação a quê? Tirando o valor, é isso que você procura?",
      "Entendo, é um investimento importante. Hoje, [o problema] custa a você [quanto] por mês. Com [a solução], isso se paga em [prazo]. O que pesa mais: o valor total ou a forma de pagar?",
    ),
    ...bloco(
      "Vou pensar",
      "Ficou alguma dúvida que a pessoa não quis dizer, ou falta alguém na decisão.",
      "Claro. Para eu te ajudar a pensar: o que ainda não ficou claro?",
      "Faz sentido pensar com calma. Normalmente quem diz isso está em dúvida sobre [valor, prazo ou resultado]. Qual desses é o seu caso? Posso te ligar [dia] para fecharmos essa dúvida.",
    ),
    ...bloco(
      "Preciso falar com outra pessoa",
      "Quem decide não está na conversa.",
      "O que você acha que essa pessoa vai querer saber?",
      "Ótimo, é uma decisão para tomar junto. Que tal marcarmos 15 minutos com vocês dois? Assim respondo direto o que surgir e você não precisa explicar tudo sozinho.",
    ),
    ...bloco(
      "Já tenho quem me atenda",
      "A pessoa está acomodada, não necessariamente satisfeita.",
      "Que bom. O que você mais gosta no atendimento de hoje? E o que mudaria se pudesse?",
      "Não precisa trocar nada agora. Posso te mostrar como resolvemos [o ponto que a pessoa mudaria] para você ter uma comparação quando precisar?",
    ),
    ...bloco(
      "Agora não é o momento",
      "Outra prioridade na frente, ou a urgência ainda não ficou clara.",
      "Entendo. O que precisa acontecer para ser o momento?",
      "Sem problema. Só para você ter a conta: esperar até [mês] significa [o que se perde]. Se preferir esperar, eu te chamo no dia [data]. Combinado?",
    ),
    ...bloco(
      "Me manda por mensagem",
      "Uma forma educada de encerrar, ou falta de tempo naquele momento.",
      "Mando sim. Para eu enviar só o que interessa: o que você quer ver primeiro?",
      "Envio agora. Como a proposta depende de alguns detalhes seus, te ligo [dia e hora] por cinco minutos para ajustar. Pode ser?",
    ),
    h(2, "A do nosso ramo"),
    ...bloco(ramo.objecao.fala, ramo.objecao.porTras, ramo.objecao.pergunta, ramo.objecao.resposta),
    divisor(),
    h(2, "Objeções novas"),
    p("Ouviu uma objeção que não está aqui? Anote abaixo com a resposta que funcionou. A equipe inteira aprende."),
    lista(["[objeção] e [resposta que funcionou]"]),
  );
}

function boasVindas(contexto?: ContextoDoModelo): DocDoEditor {
  const ramo = ramoDe(contexto);
  const empresa = empresaDe(contexto);
  return doc(
    p(`Que bom ter você na ${empresa}. Esta página é o seu mapa das primeiras semanas: marque cada item quando concluir e pergunte sempre que travar.`),
    h(2, "Primeiro dia"),
    tarefas([
      "Entrar no CRM, colocar foto e conferir nome e telefone no perfil",
      "Ler o Playbook de vendas inteiro",
      "Conhecer a equipe e saber quem cuida de quê",
      "Acompanhar dois atendimentos de um colega, só ouvindo",
      "Instalar o CRM no celular (adicionar à tela inicial)",
    ]),
    h(2, "Primeira semana"),
    tarefas([
      `Estudar ${ramo.oferta}: o que é, para quem serve e quanto custa`,
      "Ler o Roteiro de abordagem e treinar a abertura em voz alta",
      "Ler as Respostas para objeções e escolher as três mais difíceis para treinar",
      "Fazer os primeiros contatos com um colega ao lado",
      "Cadastrar no CRM todo contato feito, com próxima ação e data",
      "Conversar com quem lidera no fim da semana: o que foi fácil e o que travou",
    ]),
    h(2, "Primeiro mês"),
    lista([
      [b("Meta de atividade: "), "[contatos por dia e propostas por semana]"],
      [b("Meta de resultado: "), "[primeira venda até o dia tal]"],
      [b("Aprender: "), `conduzir ${ramo.encontro} do começo ao fim sem ajuda`],
    ]),
    h(2, "Como usamos o CRM"),
    lista([
      "Cada pessoa interessada é um negócio. Nada fica só no WhatsApp ou no caderno.",
      "Todo negócio aberto tem próxima ação com data.",
      "Mudou de etapa na vida real, muda de etapa no CRM no mesmo dia.",
      "A Agenda mostra o que é para hoje. Comece o dia por ela.",
      "Negócio perdido leva o motivo. É assim que a equipe melhora.",
    ]),
    h(2, "A quem pedir ajuda"),
    lista([
      [b("Dúvida sobre o que vendemos: "), "[nome]"],
      [b("Dúvida sobre preço e condição: "), "[nome]"],
      [b("Problema com o CRM: "), "[nome]"],
      [b("Depois da venda: "), "[nome]"],
    ]),
    h(2, "Combinados da equipe"),
    lista([
      "Horário de atendimento: [horário]",
      "Reunião da equipe: [dia e hora]",
      "Contato novo é respondido no mesmo dia",
      `O ${ramo.cliente} de um colega é do colega: na dúvida, pergunte antes de abordar`,
    ]),
  );
}

export const MODELOS: ModeloDePagina[] = [
  { id: "playbook", titulo: "Playbook de vendas", resumo: "Quem compra, etapas do funil, ritmo de contato e regras da casa", conteudo: playbook },
  { id: "roteiro", titulo: "Roteiro de abordagem", resumo: "Abertura, perguntas, próximo passo e mensagens prontas", conteudo: roteiro },
  { id: "objecoes", titulo: "Respostas para objeções", resumo: "O que está por trás de cada objeção e como responder", conteudo: objecoes },
  { id: "boas_vindas", titulo: "Boas-vindas do vendedor novo", resumo: "Primeiro dia, primeira semana e como a equipe usa o CRM", conteudo: boasVindas },
];

export const modeloPorId = (id: string): ModeloDePagina | null => MODELOS.filter((m) => m.id === id)[0] || null;

// --------------------------------------------------------------------------
// Banco
// --------------------------------------------------------------------------

const COLUNAS = "id, conta_id, pai_id, titulo, icone, visivel_para, ordem, versao, criado_por, atualizado_por, criado_em, atualizado_em, arquivada_em";

/** `conflito`: outra pessoa gravou antes. `sem_permissao`: o banco não deixou. `limite`: 500 páginas. */
export class ErroDoEspaco extends Error {
  codigo: "conflito" | "sem_permissao" | "limite" | "tamanho" | "outro";
  constructor(codigo: ErroDoEspaco["codigo"], mensagem: string) {
    super(mensagem);
    this.name = "ErroDoEspaco";
    this.codigo = codigo;
  }
}

/** A frase para a pessoa. As mensagens do banco (em português) passam direto. */
export function fraseDoErroDoEspaco(e: unknown, padrao = "Não foi possível concluir. Tente de novo."): string {
  if (e instanceof ErroDoEspaco) return e.message;
  const o = e && typeof e === "object" ? (e as { message?: unknown; code?: unknown }) : null;
  const mensagem = o && typeof o.message === "string" ? o.message : "";
  if (o && o.code === "23514" && /página|páginas/.test(mensagem) && mensagem.indexOf("violates") < 0) return mensagem;
  if (o && o.code === "23514" && mensagem.indexOf("conteudo") >= 0) return "Esta página ficou grande demais. Divida o conteúdo em páginas menores.";
  if (o && o.code === "42501") return "Você não tem permissão para fazer isso nesta página.";
  return padrao;
}

function lerPagina(l: any): PaginaDoEspaco {
  const v = l && (l.visivel_para === "gestores" || l.visivel_para === "eu") ? l.visivel_para : "todos";
  return {
    id: String(l.id),
    conta_id: String(l.conta_id),
    pai_id: l.pai_id ? String(l.pai_id) : null,
    titulo: typeof l.titulo === "string" ? l.titulo : "",
    icone: typeof l.icone === "string" && l.icone ? l.icone : null,
    visivel_para: v,
    ordem: Number(l.ordem) || 0,
    versao: Number(l.versao) || 1,
    criado_por: l.criado_por ? String(l.criado_por) : null,
    atualizado_por: l.atualizado_por ? String(l.atualizado_por) : null,
    criado_em: String(l.criado_em || ""),
    atualizado_em: String(l.atualizado_em || ""),
    arquivada_em: l.arquivada_em ? String(l.arquivada_em) : null,
  };
}

export const chaveDoEspaco = (contaId: string) => ["produto", "espaco", contaId] as const;

/** Todas as páginas que a pessoa enxerga (arquivadas junto), sem o conteúdo. */
export async function listarPaginas(): Promise<PaginaDoEspaco[]> {
  const { data, error } = await db.from("crm_paginas").select(COLUNAS).order("ordem", { ascending: true }).order("criado_em", { ascending: true }).limit(LIMITE_DE_PAGINAS);
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map(lerPagina);
}

/** Uma página com o conteúdo. Nulo quando não existe ou a pessoa não pode ler. */
export async function abrirPagina(id: string): Promise<PaginaCompleta | null> {
  const { data, error } = await db.from("crm_paginas").select(`${COLUNAS}, conteudo`).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { ...lerPagina(data), conteudo: lerDoc(data.conteudo) };
}

export interface PaginaNova {
  titulo?: string;
  icone?: string | null;
  conteudo?: DocDoEditor;
  pai_id?: string | null;
  visivel_para?: VisivelPara;
  ordem?: number;
}

export async function criarPagina(nova: PaginaNova): Promise<PaginaDoEspaco> {
  const conteudo = nova.conteudo || docVazio();
  if (!cabeNoTeto(conteudo)) throw new ErroDoEspaco("tamanho", "Esta página ficou grande demais. Divida o conteúdo em páginas menores.");
  const { data, error } = await db
    .from("crm_paginas")
    .insert({
      titulo: (nova.titulo || "").slice(0, LIMITE_DO_TITULO),
      icone: nova.icone || null,
      conteudo,
      pai_id: nova.pai_id || null,
      visivel_para: nova.visivel_para || "todos",
      ordem: typeof nova.ordem === "number" ? nova.ordem : 0,
    })
    .select(COLUNAS)
    .single();
  if (error) {
    if (error.code === "23514" && String(error.message || "").indexOf("500") >= 0) throw new ErroDoEspaco("limite", String(error.message));
    throw error;
  }
  return lerPagina(data);
}

export type MudancasDaPagina = Partial<{
  titulo: string;
  icone: string | null;
  conteudo: DocDoEditor;
  pai_id: string | null;
  visivel_para: VisivelPara;
  ordem: number;
  arquivada_em: string | null;
}>;

/**
 * Grava as mudanças. Com `versao`, só grava se ninguém gravou depois dela:
 * se alguém gravou, lança `conflito` em vez de passar por cima.
 */
export async function salvarPagina(id: string, mudancas: MudancasDaPagina, versao?: number): Promise<PaginaDoEspaco> {
  const corpo: Record<string, unknown> = { ...mudancas };
  if (typeof corpo.titulo === "string") corpo.titulo = (corpo.titulo as string).slice(0, LIMITE_DO_TITULO);
  if (corpo.conteudo && !cabeNoTeto(corpo.conteudo)) throw new ErroDoEspaco("tamanho", "Esta página ficou grande demais. Divida o conteúdo em páginas menores.");
  let pedido = db.from("crm_paginas").update(corpo).eq("id", id);
  if (typeof versao === "number") pedido = pedido.eq("versao", versao);
  const { data, error } = await pedido.select(COLUNAS);
  if (error) throw error;
  const linha = Array.isArray(data) ? data[0] : null;
  if (linha) return lerPagina(linha);
  // Nada gravado: ou a versão mudou, ou o banco não deixou (ou a página saiu).
  if (typeof versao === "number") {
    const { data: atual } = await db.from("crm_paginas").select("versao").eq("id", id).maybeSingle();
    if (atual && Number(atual.versao) !== versao) throw new ErroDoEspaco("conflito", "Esta página foi alterada em outro lugar. Recarregue para ver a versão nova.");
  }
  throw new ErroDoEspaco("sem_permissao", "Você não tem permissão para alterar esta página.");
}

export const arquivarPagina = (id: string) => salvarPagina(id, { arquivada_em: new Date().toISOString() });
export const restaurarPagina = (id: string) => salvarPagina(id, { arquivada_em: null });
export const moverPagina = (id: string, paiId: string | null, ordem: number) => salvarPagina(id, { pai_id: paiId, ordem });

/** Exclui de vez, com tudo o que está dentro. */
export async function excluirPagina(id: string): Promise<void> {
  const { data, error } = await db.from("crm_paginas").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) throw new ErroDoEspaco("sem_permissao", "Você não tem permissão para excluir esta página.");
}

/** Cria a página de um modelo pronto, já com as palavras da empresa. */
export function criarDoModelo(modelo: ModeloDePagina, contexto: ContextoDoModelo, onde: { pai_id?: string | null; ordem?: number } = {}): Promise<PaginaDoEspaco> {
  return criarPagina({ titulo: modelo.titulo, conteudo: modelo.conteudo(contexto), pai_id: onde.pai_id || null, ordem: onde.ordem, visivel_para: "todos" });
}
