/**
 * Regras puras do agente da Central ("Atualizar todos").
 *
 * O dossiê geral de cada cliente é longo (20 a 30 mil caracteres), escrito
 * por várias mãos (equipe, MCP, ChatGPT Work) e com estruturas diferentes.
 * O agente NÃO reescreve o dossiê inteiro: isso arriscaria perder o que a
 * equipe escreveu. Ele mantém duas seções próprias, sempre no mesmo lugar,
 * do jeito que os avanços automáticos já fazem:
 *
 *   ...texto da equipe (intocado)...
 *   ## Leitura da Central (agente, DD/MM/AAAA)      <- substituída a cada rodada
 *   ## Confirmado pelo dono (agente da Central)     <- acumula (últimas 12)
 *   ## Conversas do grupo de WhatsApp               <- n8n, uma só, imediatamente antes dos avanços
 *   ## Avanços recentes (automático, ...)           <- do banco, sempre por último
 *
 * A seção de avanços fica por último. O que o n8n grava depois dela (em
 * especial "Conversas do grupo de WhatsApp") não faz parte do bloco
 * automático: a rotina e esta composição tiram essa cauda, evitam seção
 * repetida e recolocam o WhatsApp imediatamente antes dos avanços.
 */

export const MARCADOR_AVANCOS = "## Avanços recentes (automático";
export const MARCADOR_WHATSAPP = "## Conversas do grupo de WhatsApp";
export const MARCADOR_LEITURA = "## Leitura da Central (agente";
export const MARCADOR_CONFIRMADO = "## Confirmado pelo dono (agente da Central)";
export const MAX_CONFIRMACOES = 12;

// ─── Seleção dos clientes ────────────────────────────────────

export interface PerfilDoCliente {
  id: string;
  plan_status?: string | null;
  client_type?: string | null;
  deleted_at?: string | null;
  services_config?: Record<string, unknown> | null;
}

/**
 * A mesma régua do Ciclo e da Esteira: plano ativo (sem status conta como
 * ativo), cliente recorrente (avulso fica fora), empresa do grupo fora, e
 * com projeto (o ritual publicado precisa de um projeto do cliente).
 */
export function clienteEntraNoAgente(p: PerfilDoCliente, temProjeto: boolean): boolean {
  if (!p || p.deleted_at) return false;
  if ((p.plan_status || "active") !== "active") return false;
  if ((p.client_type || "recurring") === "one_off") return false;
  if (p.services_config && (p.services_config as Record<string, unknown>).internal_company) return false;
  return temProjeto;
}

// ─── Leitura e perguntas ─────────────────────────────────────

export interface LeituraDaSemana {
  onde_estamos: string;
  fase: { nome: string; motivo: string; proximo_degrau: string };
  o_que_andou: string[];
  pendencias: string[];
  proximos: Array<{ frente: "social" | "trafego" | "geral"; passo: string }>;
  lacunas: string[];
}

export interface PerguntaDoAgente {
  pergunta: string;
  por_que: string;
}

const limpo = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").replace(/—/g, ",").trim().slice(0, max);
const lista = (v: unknown, max: number, tam = 220) =>
  (Array.isArray(v) ? v : []).map((x) => limpo(x, tam)).filter((x) => x.length > 2).slice(0, max);

export function normalizarLeitura(raw: unknown): LeituraDaSemana {
  const r = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const f = r.fase && typeof r.fase === "object" ? r.fase as Record<string, unknown> : {};
  const proximos = (Array.isArray(r.proximos) ? r.proximos : [])
    .map((x) => {
      if (typeof x === "string") return { frente: "geral" as const, passo: limpo(x, 240) };
      const o = x && typeof x === "object" ? x as Record<string, unknown> : {};
      const frente = o.frente === "social" || o.frente === "trafego" ? o.frente : "geral";
      return { frente, passo: limpo(o.passo, 240) };
    })
    .filter((x) => x.passo.length > 3)
    .slice(0, 6) as LeituraDaSemana["proximos"];
  return {
    onde_estamos: limpo(r.onde_estamos, 600),
    fase: { nome: limpo(f.nome, 40), motivo: limpo(f.motivo, 200), proximo_degrau: limpo(f.proximo_degrau, 240) },
    o_que_andou: lista(r.o_que_andou, 6),
    pendencias: lista(r.pendencias, 6),
    proximos,
    lacunas: lista(r.lacunas, 4, 160),
  };
}

/** Exatamente as duas melhores perguntas (ou menos, se a IA trouxe menos). */
export function normalizarPerguntas(raw: unknown): PerguntaDoAgente[] {
  const vistas = new Set<string>();
  const saida: PerguntaDoAgente[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const o = typeof x === "string" ? { pergunta: x } : (x && typeof x === "object" ? x as Record<string, unknown> : {});
    let pergunta = limpo(o.pergunta, 280);
    if (pergunta.length < 8) continue;
    if (!/[?]$/.test(pergunta)) pergunta = `${pergunta.replace(/[.!]+$/, "")}?`;
    const chave = pergunta.toLowerCase();
    if (vistas.has(chave)) continue;
    vistas.add(chave);
    saida.push({ pergunta, por_que: limpo(o.por_que, 240) });
    if (saida.length === 2) break;
  }
  return saida;
}

// ─── Seções do dossiê ────────────────────────────────────────

const NOME_DA_FRENTE: Record<string, string> = { social: "Conteúdo", trafego: "Anúncios", geral: "Geral" };

export function dataBr(agora: Date): string {
  return agora.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** A seção de leitura, em markdown, no padrão das seções do dossiê. */
export function secaoDaLeitura(l: LeituraDaSemana, agora: Date): string {
  const bloco = (titulo: string, itens: string[]) => (itens.length ? [`**${titulo}:**`, ...itens.map((i) => `- ${i}`)] : []);
  return [
    `${MARCADOR_LEITURA}, ${dataBr(agora)})`,
    l.onde_estamos ? `**Onde estamos:** ${l.onde_estamos}` : "",
    l.fase.nome ? `**Fase do método Acelera:** ${l.fase.nome}${l.fase.motivo ? ` (${l.fase.motivo})` : ""}${l.fase.proximo_degrau ? `. Próximo degrau: ${l.fase.proximo_degrau}` : ""}` : "",
    ...bloco("O que andou", l.o_que_andou),
    ...bloco("Pendências", l.pendencias),
    ...bloco("Próximos passos", l.proximos.map((p) => `${NOME_DA_FRENTE[p.frente] ?? "Geral"}: ${p.passo}`)),
    ...bloco("O que o painel ainda não diz", l.lacunas),
  ].filter(Boolean).join("\n");
}

/** Linhas "- DD/MM/AAAA · texto" da seção de confirmações. */
export function linhasDeConfirmacao(agora: Date, confirmacoes: string[]): string[] {
  const d = dataBr(agora);
  return confirmacoes.map((c) => limpo(c, 400)).filter((c) => c.length > 3).map((c) => `- ${d} · ${c}`);
}

function removerSecao(texto: string, marcador: string): { resto: string; corpo: string } {
  const i = texto.indexOf(marcador);
  if (i < 0) return { resto: texto, corpo: "" };
  const depois = texto.slice(i + marcador.length);
  const prox = depois.search(/\n#{1,2} /);
  const fim = prox < 0 ? texto.length : i + marcador.length + prox;
  return { resto: `${texto.slice(0, i).trimEnd()}${fim < texto.length ? `\n\n${texto.slice(fim).trimStart()}` : ""}`, corpo: texto.slice(i, fim) };
}

function tituloDa(secao: string): string {
  return secao.split(/\r?\n/, 1)[0].replace(/\r$/, "");
}

/** O título com data ou travessão continua sendo a mesma seção do n8n. */
export function ehSecaoWhatsapp(titulo: string): boolean {
  if (!titulo.startsWith(MARCADOR_WHATSAPP)) return false;
  if (titulo.length === MARCADOR_WHATSAPP.length) return true;
  return !/^[\p{L}\p{N}]/u.test(titulo.slice(MARCADOR_WHATSAPP.length));
}

function localizarSecao(texto: string, chave: string, whatsapp: boolean): { start: number; end: number } | null {
  const agulha = whatsapp ? MARCADOR_WHATSAPP : chave;
  let de = 0;
  while (de < texto.length) {
    const pos = texto.indexOf(agulha, de);
    if (pos < 0) return null;
    if (pos === 0 || texto[pos - 1] === "\n") {
      const nl = texto.indexOf("\n", pos);
      const titulo = (nl < 0 ? texto.slice(pos) : texto.slice(pos, nl)).replace(/\r$/, "");
      if (whatsapp ? ehSecaoWhatsapp(titulo) : titulo === chave) {
        const linhaFim = nl < 0 ? texto.length : nl;
        const prox = texto.slice(linhaFim).search(/\n## /);
        return { start: pos, end: prox < 0 ? texto.length : linhaFim + prox + 1 };
      }
    }
    de = pos + 1;
  }
  return null;
}

function semTrecho(texto: string, loc: { start: number; end: number }, troca = ""): string {
  const prefixo = texto.slice(0, loc.start).replace(/[ \t\r\n]+$/g, "");
  const sufixo = texto.slice(loc.end).replace(/^[ \t\r\n]+/g, "");
  return [prefixo, troca.trim(), sufixo].filter((p) => p.length > 0).join("\n\n");
}

/** Separa o bloco automático do que foi anexado depois dele. */
export function separarBlocoAutomatico(texto: string): { antes: string; avancos: string; externas: string[] } {
  const pos = texto.indexOf(MARCADOR_AVANCOS);
  if (pos < 0) return { antes: texto.replace(/[ \t\r\n]+$/g, ""), avancos: "", externas: [] };
  const partes = texto.slice(pos).split(/\n(?=## )/);
  return {
    antes: texto.slice(0, pos).replace(/[ \t\r\n]+$/g, ""),
    avancos: (partes[0] ?? "").trim(),
    externas: partes.slice(1).map((p) => p.trim()).filter((p) => p && !tituloDa(p).startsWith(MARCADOR_AVANCOS)),
  };
}

/**
 * Uma única seção de WhatsApp, a mais nova, e as outras seções de fora do
 * bloco automático sem duplicar o mesmo título.
 */
export function mesclarSecoesExternas(antes: string, externas: string[]): { corpo: string; whatsapp: string } {
  let corpo = antes.trim();
  let whatsapp = "";
  const outras: string[] = [];
  for (const secao of externas) {
    if (ehSecaoWhatsapp(tituloDa(secao))) whatsapp = secao.trim();
    else outras.push(secao.trim());
  }
  const copias: string[] = [];
  for (let passos = 0; passos < 30; passos += 1) {
    const loc = localizarSecao(corpo, MARCADOR_WHATSAPP, true);
    if (!loc) break;
    copias.push(corpo.slice(loc.start, loc.end).trim());
    corpo = semTrecho(corpo, loc);
  }
  if (!whatsapp && copias.length) whatsapp = copias[copias.length - 1];
  for (const secao of outras) {
    const loc = localizarSecao(corpo, tituloDa(secao), false);
    corpo = loc ? semTrecho(corpo, loc, secao) : [corpo, secao].filter((p) => p.length > 0).join("\n\n");
  }
  return { corpo: corpo.trim(), whatsapp: whatsapp.trim() };
}

/**
 * Monta o conteúdo novo do dossiê: o texto da equipe intocado, a leitura
 * nova no lugar da antiga, as confirmações novas em cima das antigas (até
 * 12), a conversa de WhatsApp numa seção só e os avanços automáticos por último.
 */
export function comporDossie(atual: string, novo: { leitura?: string | null; confirmacoes?: string[] }): string {
  const separado = separarBlocoAutomatico(String(atual ?? ""));
  const mesclado = mesclarSecoesExternas(separado.antes, separado.externas);
  let humano = mesclado.corpo;

  const semLeitura = removerSecao(humano, MARCADOR_LEITURA);
  const leituraAntiga = semLeitura.corpo.trim();
  humano = semLeitura.resto;
  const semConf = removerSecao(humano, MARCADOR_CONFIRMADO);
  humano = semConf.resto.trimEnd();
  const antigas = semConf.corpo.split(/\r?\n/).slice(1).map((l) => l.trim()).filter((l) => l.startsWith("- "));
  const todas = [...(novo.confirmacoes ?? []), ...antigas];
  const vistas = new Set<string>();
  const unicas = todas.filter((l) => {
    const fato = l.replace(/^- \d{2}\/\d{2}\/\d{4} · /, "").toLocaleLowerCase("pt-BR").trim();
    if (vistas.has(fato)) return false;
    vistas.add(fato);
    return true;
  }).slice(0, MAX_CONFIRMACOES);

  const leitura = (novo.leitura ?? leituraAntiga).trim();
  return [
    humano,
    leitura,
    unicas.length ? [MARCADOR_CONFIRMADO, ...unicas].join("\n") : "",
    mesclado.whatsapp,
    separado.avancos,
  ].filter((p) => p && p.trim()).join("\n\n");
}

/** Fatos do ritual quando quem pede é o agente (não há painel no navegador). */
export function fatosDoAgente(input: {
  nome: string;
  planoNome?: string | null;
  servicos: string[];
  dossie: string;
  versao: number | null;
  leitura: LeituraDaSemana;
  respostas: Array<{ pergunta: string; resposta: string }>;
  contextoExtra?: string;
}): string {
  const respondidas = input.respostas.filter((r) => r.resposta.trim());
  return [
    `Cliente: ${input.nome}`,
    input.planoNome ? `Plano contratado atual: ${input.planoNome}` : "",
    `Serviços contratados atuais (fale do trabalho em todas as frentes): ${input.servicos.join(", ") || "nenhuma frente identificada no cadastro; não presumir contratação"}`,
    respondidas.length
      ? `CONFIRMADO AGORA PELO DONO DA AGÊNCIA (vale sobre o que o painel sugere; use como fato, sem citar que foi pergunta):\n${respondidas.map((r) => `- ${r.pergunta} Resposta: ${r.resposta}`).join("\n")}`
      : "",
    input.contextoExtra?.trim() ? `CONTEXTO EXTRA DO DONO (fato atual):\n${input.contextoExtra.trim().slice(0, 2000)}` : "",
    `LEITURA DA SEMANA (agente da Central):\n${secaoDaLeitura(input.leitura, new Date())}`,
    `DOSSIÊ GERAL ATUAL v${input.versao ?? "?"} (fonte da verdade do "onde estamos"):\n${input.dossie}`,
  ].filter(Boolean).join("\n\n");
}
