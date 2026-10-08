/**
 * Resposta de agente em partes (09/10/2026): o núcleo de apresentação comum
 * a todos os agentes que respondem em TEXTO (Hermes hoje; agentes das Mesas no
 * lote B). O Gestor já responde estruturado; este módulo dá o mesmo resultado a
 * quem fala em texto livre:
 *
 * - o agente escreve conversa e, quando o pedido pede (relatório, números,
 *   comparação, processo, diagrama), um ou mais trechos marcados
 *   ```aceleriq-blocos { "blocos": [...] } ```;
 * - aqui o texto vira balões curtos (sem bloco gigante) e os trechos viram
 *   blocos validados pelo MESMO validador do Gestor (_shared/blocos-de-resposta.ts);
 * - número só vale com fonte conhecida (para o Hermes: as ferramentas que ele
 *   chamou naquele turno); trecho inválido sai e fica registrado o motivo.
 *
 * Sem dependências além do validador: roda na função (Deno) e na tela.
 * Compatível com Safari 11 (sem lookbehind, \p ou grupos nomeados).
 */

import { type BlocoDeResposta, validarBlocos } from "./blocos-de-resposta.ts";

export const MARCA_DOS_BLOCOS = "aceleriq-blocos";

export type ParteDaResposta =
  | { tipo: "texto"; texto: string }
  | { tipo: "blocos"; blocos: BlocoDeResposta[] };

export type RespostaEmPartes = { partes: ParteDaResposta[]; recusados: string[]; fontes: string[] };

/** Teto de um balão: texto maior é dividido nos parágrafos (nunca no meio de tabela, lista ou código). */
const TETO_DO_BALAO = 700;

const ABRE = "```" + MARCA_DOS_BLOCOS;

/** Divide texto em balões: por parágrafo, juntando os pequenos, sem quebrar tabela, lista ou bloco de código. */
export function baloesDoTexto(texto: string): string[] {
  const limpo = String(texto || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!limpo) return [];
  // Blocos de código inteiros ficam juntos (o separador de parágrafo não age dentro deles).
  const pedacos: string[] = [];
  const linhas = limpo.split("\n");
  let atual: string[] = [];
  let emCodigo = false;
  const fecha = () => { const t = atual.join("\n").trim(); if (t) pedacos.push(t); atual = []; };
  for (const l of linhas) {
    if (/^\s*```/.test(l)) emCodigo = !emCodigo;
    if (!emCodigo && l.trim() === "") { fecha(); continue; }
    atual.push(l);
  }
  fecha();
  const ehTabelaOuLista = (p: string) => /^\s*\|/.test(p) || /^\s*([-*+]|\d+[.)])\s/.test(p);
  const ehTitulo = (p: string) => /^\s*#{1,6}\s/.test(p) || /^\s*\*\*[^*]{1,80}\*\*:?\s*$/.test(p);
  const baloes: string[] = [];
  let acc = "";
  for (const p of pedacos) {
    // Título curto cola no parágrafo seguinte; lista e tabela colam no texto que as apresenta.
    if (!acc) { acc = p; continue; }
    const cabe = acc.length + p.length + 2 <= TETO_DO_BALAO;
    if (ehTitulo(acc) || (ehTabelaOuLista(p) && acc.length < 240) || (cabe && acc.length < 160)) acc = `${acc}\n\n${p}`;
    else { baloes.push(acc); acc = p; }
  }
  if (acc) baloes.push(acc);
  return baloes;
}

/** Tira "Claro!", "Aqui está o relatório:" e afins do começo (introdução repetida não vira balão). */
export function semIntroducaoVazia(texto: string): string {
  return String(texto || "").replace(/^\s*(claro|perfeito|certo|ótimo|otimo|beleza|com certeza|entendido)[!.,]?\s*(aqui est[áa][^\n.:!]*[.:!])?\s*/i, "").trim();
}

/** Durante o stream: o trecho de blocos ainda incompleto não aparece cru na tela. */
export function textoParcialSemBlocos(texto: string): { texto: string; montando: boolean } {
  const t = String(texto || "");
  let saida = "";
  let resto = t;
  let montando = false;
  for (;;) {
    const i = resto.indexOf(ABRE);
    if (i < 0) { saida += resto; break; }
    saida += resto.slice(0, i);
    const depois = resto.slice(i + ABRE.length);
    const fim = depois.indexOf("```");
    if (fim < 0) { montando = true; break; }
    resto = depois.slice(fim + 3);
  }
  return { texto: saida.trim(), montando };
}

/**
 * Separa a resposta em balões de texto e blocos validados.
 * `fontesConhecidas`: o que pode sustentar número (para o Hermes, as
 * ferramentas chamadas no turno). Sem a lista, número em bloco é recusado.
 */
export function separarResposta(texto: string, opcoes: { fontesConhecidas?: string[]; hostsPermitidos?: string[] } = {}): RespostaEmPartes {
  const t = semIntroducaoVazia(String(texto || "").replace(/\r\n/g, "\n"));
  const partes: ParteDaResposta[] = [];
  const recusados: string[] = [];
  const fontes = new Set<string>();
  let resto = t;
  const fontesConhecidas = opcoes.fontesConhecidas || [];
  const empurrarTexto = (x: string) => { for (const b of baloesDoTexto(x)) partes.push({ tipo: "texto", texto: b }); };
  for (;;) {
    const i = resto.indexOf(ABRE);
    if (i < 0) { empurrarTexto(resto); break; }
    empurrarTexto(resto.slice(0, i));
    const depois = resto.slice(i + ABRE.length);
    const fim = depois.indexOf("```");
    if (fim < 0) { recusados.push("quadro sem fechamento"); break; }
    const bruto = depois.slice(0, fim).trim();
    resto = depois.slice(fim + 3);
    let json: unknown = null;
    try { json = JSON.parse(bruto); } catch { recusados.push("quadro com JSON inválido"); continue; }
    const { blocos, recusados: r } = validarBlocos(json, { fontesConhecidas, hostsPermitidos: opcoes.hostsPermitidos });
    for (const x of r) recusados.push(x.motivo);
    // Fluxo é desenho do agente: sempre "Proposta" (estado do sistema vem de progresso/entrega, conferidos à parte).
    const ajustados = blocos.map((b) => (b.tipo === "fluxo" ? { ...b, natureza: "proposta" as const, passos: b.passos.map((p) => ({ ...p, estado: "planejado" as const })) } : b));
    for (const b of ajustados) for (const f of ("fontes" in b && b.fontes) || []) fontes.add(String(f));
    if (ajustados.length) partes.push({ tipo: "blocos", blocos: ajustados });
  }
  return { partes, recusados, fontes: [...fontes] };
}

/**
 * Instrução de apresentação para agentes que respondem em texto (vai junto do
 * pedido; não muda o modelo nem as ferramentas do agente).
 */
export const INSTRUCAO_DE_APRESENTACAO = `Você está respondendo dentro da Central do painel Aceleriq, que desenha quadros a partir de dados estruturados.
COMO ESCREVER
- Conversa, não relatório corrido: mensagens curtas separadas por linha em branco (cada parágrafo vira um balão). Comece pelo que importa. Sem introdução de cortesia ("Claro!", "Aqui está...") e sem repetir o que já disse.
- Pergunta simples, resposta simples: só texto, sem quadro.
QUADROS (só quando o pedido for relatório, números, comparação, processo ou diagrama)
- Inclua um ou mais trechos exatamente assim (JSON válido, sem comentários):
\`\`\`${MARCA_DOS_BLOCOS}
{"blocos":[ ... ]}
\`\`\`
- Tipos aceitos (campos opcionais podem ser null):
  metricas: {"tipo":"metricas","titulo":"...","itens":[{"rotulo":"...","valor":12,"variacao":"+3 vs semana anterior","tom":"neutro|bom|alerta|perigo"}],"fontes":["<ferramenta>"]}
  grafico: {"tipo":"grafico","titulo":"...","tipo_grafico":"barras|linhas|pizza","series":[{"nome":"...","pontos":[{"x":"rótulo","y":10}]}],"unidade":"...","fontes":["<ferramenta>"]}
  tabela: {"tipo":"tabela","titulo":"...","colunas":["A","B"],"linhas":[["x",1]],"fontes":["<ferramenta>"]}
  fluxo: {"tipo":"fluxo","titulo":"...","natureza":"proposta","passos":[{"id":"a","rotulo":"...","detalhe":"..."}],"ligacoes":[{"de":"a","para":"b"}]}
  progresso: {"tipo":"progresso","titulo":"...","etapas":[{"rotulo":"...","estado":"planejado|em_execucao|aguardando_aprovacao|bloqueado|concluido","quando":"...","evidencia":"..."}]}
  entrega: {"tipo":"entrega","nome":"...","tipo_objeto":"tarefa","objeto":{"tipo":"tarefa|aprovacao|projeto|arquivo|vinculo","id":"<uuid que veio da ferramenta>"},"estado":"..."}
REGRAS DE VERDADE
- Número em métricas, gráfico ou tabela só se veio de ferramenta que você chamou NESTA resposta; em "fontes" ponha o nome exato dessas ferramentas. Sem ferramenta, sem número (diga em texto que não verificou).
- Fluxo é o seu desenho (natureza "proposta"). Ids de objetos só os devolvidos pelas ferramentas. Não diga que algo foi feito sem a ferramenta ter feito.`;
