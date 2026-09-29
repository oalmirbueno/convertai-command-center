/**
 * Ações que o agente da Mesa Publicidade propõe e a equipe confirma
 * (contrato comum em ../_shared/acoes-do-agente.ts): apelidos no lugar de
 * UUID, cartão Confirmar/Cancelar, execução item a item, Desfazer quando há
 * reverso, travas por item e auditLog na execução (index.ts).
 *
 * - propor_territorios (k1, a campanha): o diretor propõe três territórios (gasta IA).
 * - pedir_tomadas (t1..t4, o território aprovado): pede as seis tomadas à Mesa Foto
 *   (campanha_planejar da Mesa Foto; gasta IA do diretor de fotografia).
 * - reprovar_foto (f1..fN): reprova na Mesa Foto a foto cuja conferência mostra o
 *   produto mudado (logo, formato, cor, detalhe). Sem reverso: a versão fica reprovada.
 * - mandar_para_ads / mandar_para_mesa (f1..fN): registra o encaminhamento com a
 *   linhagem. Desfazer apaga o registro. Não aprova anúncio nem verba.
 * - editar_briefing (k1, frente AG 26/09): troca um campo do briefing (versão nova;
 *   Desfazer volta o briefing de antes). Sem custo: pedido claro vai direto.
 * - renomear_campanha (k1): nome novo (Desfazer volta o nome). Sem custo: direto.
 * - aprovar_territorio (t1..t4): aprova e monta o plano das seis tomadas. Confirmar,
 *   sem Desfazer (para mudar, aprove outro antes de pedir as tomadas).
 * Frente AG2 (29/09):
 * - avaliar_revisao (k1): lê o ensaio na Mesa Foto e aplica a regra do produto (sem Jev,
 *   sem custo). Direta: não muda nada que precise voltar.
 * - aprovar_foto (f1..fN): aprova na Mesa Foto só a foto com o produto conferido. Confirmar,
 *   sem Desfazer (a versão aprovada fica travada lá).
 * - refazer_foto (f1..fN): reprova a versão com o motivo (a Mesa Foto usa o motivo na próxima)
 *   e gera uma versão nova da tomada. Gasta imagem: custo no cartão e Confirmar.
 * - editar_briefing ganhou objetivo, formatos e o que não pode mudar no produto (logo, cor da
 *   variante, detalhes, outras restrições).
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo.
 */
import {
  type AcaoDoAgente,
  type Alvo,
  type AlvoComApelido,
  blocoDosAlvos,
  type CaminhoDoAgente,
  esquemaDasAcoes,
  type ItemDaAcaoDoAgente,
  normalizarAcaoDoAgente,
  regraDasAcoes,
  type RegraDaOperacao,
} from "../_shared/acoes-do-agente.ts";
import { caminhoNaArea } from "../_shared/mapa-do-painel.ts";
import { type CampanhaDePublicidade, enderecoDoDestino, ROTULO_DA_MUDANCA, type RevisaoDePublicidade } from "./regras.ts";

export const OPERACOES_DA_PUBLICIDADE = ["propor_territorios", "pedir_tomadas", "reprovar_foto", "mandar_para_ads", "mandar_para_mesa", "editar_briefing", "renomear_campanha", "aprovar_territorio", "avaliar_revisao", "aprovar_foto", "refazer_foto"];
export const ESQUEMA_DAS_ACOES_DA_PUBLICIDADE = esquemaDasAcoes(OPERACOES_DA_PUBLICIDADE);

/** Operações sem reverso (gastam IA ou reprovam na Mesa Foto). */
export const OPERACOES_SEM_REVERSO = ["propor_territorios", "pedir_tomadas", "reprovar_foto", "aprovar_territorio", "aprovar_foto", "refazer_foto"];

/** Operações que gastam IA (o custo estimado vai no cartão antes de confirmar). */
export const OPERACOES_COM_CUSTO = ["propor_territorios", "pedir_tomadas", "refazer_foto"];

/** Campos do briefing que o agente troca por pedido (texto simples; a oferta entra como hipótese). */
export const CAMPOS_EDITAVEIS_DO_BRIEFING: Record<string, string> = {
  objetivo_texto: "objetivo",
  publico: "público",
  ocasiao: "ocasião",
  tom: "tom",
  destino: "destino",
  proibido: "o que é proibido",
  oferta: "oferta",
  // Frente AG2: o resto do briefing que a equipe pede na conversa.
  objetivo: "tipo de objetivo",
  formatos: "formatos",
  logo: "logo e texto do rótulo que não mudam",
  cor_da_variante: "cor da variante",
  detalhes: "detalhes de material que não mudam",
  outras: "outras restrições",
};

/** Objetivo em palavras ("vender", "mensagens"...) para o valor do briefing. */
const OBJETIVOS_EM_PALAVRAS: Array<[RegExp, string]> = [
  [/reconhec|lembran|marca|alcance/, "reconhecimento"],
  [/visita|loja fisica|trafego/, "visitas"],
  [/consult|mensag|whats|contato|lead/, "consultas"],
  [/experiment|provar|amostra|teste/, "experimentacao"],
  [/vend|compra|convers/, "venda"],
];

/** Valor normalizado de um campo do briefing (null quando não dá para ler). */
export function valorDoCampoDoBriefing(campo: string, valor: string): string | null {
  const t = valor.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (campo === "objetivo") {
    for (const [re, id] of OBJETIVOS_EM_PALAVRAS) if (re.test(t)) return id;
    return null;
  }
  if (campo === "formatos") {
    const achados = (valor.match(/\b(4:5|9:16|1:1|16:9)\b/g) || []).filter((f, i, l) => l.indexOf(f) === i);
    return achados.length ? achados.join(", ") : null;
  }
  return valor;
}

/** "publico: mulheres de 30 a 45" -> { campo, valor }. Campo fora da lista ou valor vazio: null. */
export function lerEdicaoDoBriefing(bruto: unknown): { campo: string; valor: string } | null {
  const s = String(bruto == null ? "" : bruto);
  const i = s.indexOf(":");
  if (i <= 0) return null;
  const campo = s.slice(0, i).trim().toLowerCase().replace(/\s+/g, "_");
  const valor = s.slice(i + 1).replace(/\s+/g, " ").trim().slice(0, 600);
  if (!Object.prototype.hasOwnProperty.call(CAMPOS_EDITAVEIS_DO_BRIEFING, campo) || valor.length < 2) return null;
  const v = valorDoCampoDoBriefing(campo, valor);
  return v ? { campo, valor: v } : null;
}

type DadosDoAlvo = {
  tipo: "campanha" | "territorio" | "foto";
  status?: string;
  tem_ensaio?: boolean;
  tem_kit?: boolean;
  veredito?: string;
  decisao?: string | null;
  imagem_id?: string | null;
  destinos?: string[];
  /** A versão mais nova da tomada (só ela pode ser aprovada ou refeita). */
  ultima?: boolean;
};
export type AlvoDaPublicidade = Alvo & { dados: DadosDoAlvo };

const ROTULO_DO_VEREDITO: Record<string, string> = {
  reprovada: "produto mudou",
  produto_ok: "produto conferido",
  nao_determinavel: "não deu para saber",
  sem_conferencia: "sem conferência",
};

function tituloDaFoto(c: CampanhaDePublicidade, r: RevisaoDePublicidade): string {
  const tomada = c.tomadas.find((t) => t.foto_tomada_id === r.foto_tomada_id || (r.tomada_id && t.id === r.tomada_id));
  return `${tomada ? tomada.nome : "Foto"} v${r.versao}`;
}

/** Os alvos do agente: a campanha (k1), os territórios (t1..t3) e as fotos revisadas (f1..fN). */
export function alvosDaPublicidade(c: CampanhaDePublicidade): Array<AlvoComApelido<AlvoDaPublicidade>> {
  const saida: Array<AlvoComApelido<AlvoDaPublicidade>> = [];
  if (c.id) {
    saida.push({
      id: c.id,
      ref: "k1",
      titulo: `Campanha ${c.nome || c.kit_nome || "sem nome"}`,
      detalhe: c.kit_nome ? `produto ${c.kit_nome}` : "sem produto",
      dados: { tipo: "campanha", tem_ensaio: !!c.ensaio_id, tem_kit: !!c.kit_id },
    });
  }
  c.territorios.slice(0, 4).forEach((t, i) => {
    if (!t.id) return;
    saida.push({
      id: t.id,
      ref: `t${i + 1}`,
      titulo: `Território ${t.nome}`,
      detalhe: t.status === "aprovado" ? "aprovado" : t.status === "descartado" ? "descartado" : "proposto",
      dados: { tipo: "territorio", status: t.status, tem_ensaio: !!c.ensaio_id, tem_kit: !!c.kit_id },
    });
  });
  c.revisoes.slice(0, 40).forEach((r, i) => {
    if (!r.id) return;
    const ultima = !c.revisoes.some((x) => x.foto_tomada_id === r.foto_tomada_id && x.versao > r.versao);
    const destinos = c.encaminhamentos.filter((e) => e.imagem_id && e.imagem_id === r.imagem_id).map((e) => e.destino);
    const mud = r.avaliacao.mudancas.map((m) => ROTULO_DA_MUDANCA[m]).join(", ");
    saida.push({
      id: r.id,
      ref: `f${i + 1}`,
      titulo: tituloDaFoto(c, r),
      detalhe: [ROTULO_DO_VEREDITO[r.avaliacao.veredito] || r.avaliacao.veredito, mud, r.decisao ? `decisão: ${r.decisao}` : "sem decisão", destinos.length ? `já em ${destinos.join(" e ")}` : ""]
        .filter(Boolean)
        .join("; "),
      dados: { tipo: "foto", veredito: r.avaliacao.veredito, decisao: r.decisao, imagem_id: r.imagem_id, destinos, ultima },
    });
  });
  return saida;
}

const travaDoEnvio = (destino: "ads" | "mesa") => (a: AlvoComApelido<AlvoDaPublicidade>) => {
  const d = a.dados;
  if (d.decisao !== "aprovada") return d.decisao === "reprovada" ? "Foto reprovada: não vai para as mesas." : "Aprove a foto na revisão antes de mandar.";
  if (d.veredito === "reprovada") return "A conferência mostra mudança no produto: não vai para as mesas.";
  if (!d.imagem_id) return "A foto aprovada ainda não está no acervo.";
  if ((d.destinos || []).indexOf(destino) >= 0) return destino === "ads" ? "Já está na Mesa Ads." : "Já está na Mesa.";
  return null;
};

export const REGRAS_DA_PUBLICIDADE: Record<string, RegraDaOperacao<AlvoDaPublicidade>> = {
  propor_territorios: {
    rotulo: "Propor 3 territórios",
    alvos: ["k"],
    trava: (a) => (a.dados.tem_ensaio ? "As tomadas já foram pedidas com o território aprovado. Abra uma campanha nova para outra direção." : !a.dados.tem_kit ? "Escolha o produto da campanha antes." : null),
  },
  pedir_tomadas: {
    rotulo: "Pedir as 6 tomadas à Mesa Foto",
    alvos: ["t"],
    trava: (a) =>
      a.dados.status !== "aprovado"
        ? "Aprove este território antes de pedir as tomadas."
        : a.dados.tem_ensaio
        ? "As seis tomadas já foram pedidas (o ensaio está na Mesa Foto)."
        : !a.dados.tem_kit
        ? "Escolha o produto da campanha antes."
        : null,
  },
  reprovar_foto: {
    rotulo: "Reprovar (produto mudou)",
    alvos: ["f"],
    trava: (a) =>
      a.dados.decisao === "aprovada"
        ? "Já aprovada: a versão aprovada fica travada na Mesa Foto."
        : a.dados.decisao === "reprovada"
        ? "Já reprovada."
        : a.dados.veredito !== "reprovada"
        ? a.dados.veredito === "sem_conferencia"
          ? "Ainda sem conferência com as fontes do produto."
          : "A conferência não mostra mudança no produto."
        : null,
  },
  mandar_para_ads: { rotulo: "Mandar para a Mesa Ads", alvos: ["f"], trava: travaDoEnvio("ads") },
  mandar_para_mesa: { rotulo: "Mandar para a Mesa", alvos: ["f"], trava: travaDoEnvio("mesa") },
  editar_briefing: {
    rotulo: "Mudar no briefing",
    alvos: ["k"],
    combina: true,
    repete: true,
    direta: true,
    para: (v) => {
      const e = lerEdicaoDoBriefing(v);
      return e ? `${e.campo}: ${e.valor}` : null;
    },
  },
  renomear_campanha: {
    rotulo: "Renomear para",
    alvos: ["k"],
    combina: true,
    direta: true,
    para: (v) => {
      const n = String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, 120);
      return n.length >= 2 ? n : null;
    },
  },
  aprovar_territorio: {
    rotulo: "Aprovar o território",
    alvos: ["t"],
    trava: (a) =>
      a.dados.status === "aprovado"
        ? "Este território já está aprovado."
        : a.dados.status === "descartado"
        ? "Este território foi descartado."
        : a.dados.tem_ensaio
        ? "As tomadas já foram pedidas com outro território. Abra uma campanha nova para mudar a direção."
        : null,
  },
  // Frente AG2: revisão pela conversa.
  avaliar_revisao: {
    rotulo: "Ler as fotos do ensaio e conferir o produto",
    alvos: ["k"],
    direta: true,
    trava: (a) => (a.dados.tem_ensaio ? null : "Peça as tomadas à Mesa Foto antes de revisar."),
  },
  aprovar_foto: {
    rotulo: "Aprovar a foto",
    alvos: ["f"],
    trava: (a) =>
      a.dados.decisao === "aprovada"
        ? "Já aprovada."
        : a.dados.decisao === "reprovada"
        ? "Já reprovada: refaça a tomada para ter uma versão nova."
        : a.dados.ultima === false
        ? "Há uma versão mais nova desta tomada."
        : a.dados.veredito === "reprovada"
        ? "A conferência mostra o produto mudado: não dá para aprovar."
        : a.dados.veredito !== "produto_ok"
        ? "O produto não foi conferido com as fontes: confira ao lado delas na Revisão e aprove lá."
        : null,
  },
  refazer_foto: {
    rotulo: "Refazer a foto",
    alvos: ["f"],
    para: (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, 400) || "sem motivo extra",
    trava: (a) =>
      a.dados.decisao === "aprovada"
        ? "Já aprovada: a versão aprovada fica travada na Mesa Foto."
        : a.dados.ultima === false
        ? "Há uma versão mais nova desta tomada: refaça a partir dela."
        : null,
  },
};

export const DESCRICOES_DA_PUBLICIDADE: Record<string, string> = {
  propor_territorios: "ref = k1 (a campanha). O diretor propõe três territórios criativos novos (gasta IA). Pedido \"proponha 3 territórios\".",
  pedir_tomadas: "ref = o território APROVADO (t1..t4). Pede as seis tomadas à Mesa Foto com o produto das fontes (gasta IA). Pedido \"peça as 6 tomadas\".",
  reprovar_foto: "ref = foto (f1..fN) cujo detalhe diz \"produto mudou\". Reprova na Mesa Foto com o motivo. Pedido \"reprove as fotos que mudaram o produto\" vale para todas com \"produto mudou\" e sem decisão.",
  mandar_para_ads: "ref = foto APROVADA (f1..fN). Registra o envio para a Mesa Ads com a linhagem. Não aprova anúncio nem verba. Pedido \"mande as aprovadas para a Mesa Ads\" vale para todas aprovadas que ainda não estão lá.",
  mandar_para_mesa: "ref = foto APROVADA. Registra o envio para a Mesa (orgânico) com a linhagem.",
  editar_briefing: "ref = k1. para = \"campo: valor novo\", campo um de objetivo_texto, publico, ocasiao, tom, destino, proibido, oferta (um item por campo). Grava versão nova do briefing. Oferta sem fonte fica como hipótese.",
  renomear_campanha: "ref = k1. para = o nome novo da campanha.",
  aprovar_territorio: "ref = território proposto (t1..t4). Aprova e monta o plano das seis tomadas (sem custo). Pedido \"aprove o território X\" ou \"aprove essa direção\".",
  avaliar_revisao: "ref = k1. Lê as fotos do ensaio na Mesa Foto e aplica a regra do produto (sem custo). Pedido \"avalie as fotos\", \"atualize a revisão\".",
  aprovar_foto: "ref = foto (f1..fN) cujo detalhe diz \"produto conferido\" e sem decisão. Aprova na Mesa Foto (sem volta). Foto que não deu para conferir a equipe aprova na Revisão, ao lado das fontes.",
  refazer_foto: "ref = foto (f1..fN), a versão mais nova da tomada, sem aprovação. para = o que corrigir (ex.: \"rótulo de frente, sem reflexo\"). Reprova a versão com esse motivo e gera uma nova na Mesa Foto (gasta imagem).",
};

/** O pedido fala de alguma das ações? Só então as listas entram no prompt. */
export function pedeAcaoNaPublicidade(mensagem: string): boolean {
  return /(propo|territ|dire[cç][aã]o|pe[cç]a|pedi|tomada|reprov|mud(ou|aram)|mand[ae]|envi[ae]|mesa ads|ads|aprov|briefing|renome|nome da campanha|p[uú]blico|ocasi|oferta|proibid|tom d[aoe]|troqu?e|mude|ajust|refa[cçz]|avali|revis|confer|foto|imagem|formato|logo|cor da|restri|objetivo|destino|essa|esse|segund|primeir|[uú]ltim|todas|todos)/i.test(String(mensagem || ""));
}

export function blocoDasAcoesDaPublicidade(c: CampanhaDePublicidade): string {
  return `${blocoDosAlvos("CAMPANHA, TERRITÓRIOS E FOTOS", alvosDaPublicidade(c), "nenhum (abra uma campanha).")}\n${regraDasAcoes(DESCRICOES_DA_PUBLICIDADE)}`;
}

/** Custo estimado por operação com IA (US$), calculado pela função com o modelo do catálogo. */
export type CustosDaPublicidade = { propor_territorios?: number | null; pedir_tomadas?: number | null; refazer_foto?: number | null };

export function normalizarAcoesDaPublicidade(bruto: unknown, c: CampanhaDePublicidade, id?: string, custos: CustosDaPublicidade = {}): AcaoDoAgente | null {
  const acao = normalizarAcaoDoAgente(bruto, alvosDaPublicidade(c), REGRAS_DA_PUBLICIDADE, {
    agente: "publicidade",
    id: id || `publicidade-${Date.now().toString(36)}`,
    contexto: { client_id: c.client_id, campanha_id: c.id },
    semDesfazer: (itens: ItemDaAcaoDoAgente[]) => itens.every((i) => OPERACOES_SEM_REVERSO.indexOf(i.operacao) >= 0),
  });
  if (!acao) return null;
  // Frente AG2: o que gasta IA leva o custo estimado no cartão (antes, nada: o cartão dizia só "gasta IA").
  let total = 0;
  let semEstimativa = false;
  for (const i of acao.itens) {
    if (OPERACOES_COM_CUSTO.indexOf(i.operacao) < 0) continue;
    const v = custos[i.operacao as keyof CustosDaPublicidade];
    if (typeof v === "number" && isFinite(v) && v >= 0) total += v;
    else semEstimativa = true;
  }
  const comCusto = acao.itens.some((i) => OPERACOES_COM_CUSTO.indexOf(i.operacao) >= 0);
  acao.custo_estimado_usd = comCusto ? (semEstimativa && !total ? null : Math.round(total * 1e6) / 1e6) : 0;
  return acao;
}

// ------------------------------------------------------------------ "essa direção", "a segunda tomada", "todas"

/** Item que o Jev escolhe (espelho do tipo de _shared/conversa-das-mesas.ts, sem importar Deno). */
export type ItemDaReferencia = { ref: string; titulo: string; detalhe?: string | null };

const semAcentoMin = (t: unknown) => String(t == null ? "" : t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * A lista para "essa", "a segunda", "todas" (frente AG2), na ordem da tela e
 * com os apelidos que o modelo vê: territórios (Direção, na ordem da
 * campanha) quando o pedido fala de território ou direção; fotos (Revisão:
 * as sem decisão primeiro) quando fala de foto, tomada, imagem ou revisão;
 * sem pista, a etapa em que a campanha está (fotos depois do ensaio,
 * territórios antes). "A segunda tomada" usa a ordem das tomadas do plano.
 */
export function itensDaReferenciaDaPublicidade(mensagem: string, c: CampanhaDePublicidade): { itens: ItemDaReferencia[]; lista: "territorios" | "fotos" } {
  const t = semAcentoMin(mensagem);
  const alvos = alvosDaPublicidade(c);
  const territorios = alvos.filter((a) => a.dados.tipo === "territorio").map((a) => ({ ref: a.ref, titulo: a.titulo, detalhe: a.detalhe || null }));
  const porId: Record<string, AlvoComApelido<AlvoDaPublicidade>> = {};
  alvos.forEach((a) => {
    if (a.dados.tipo === "foto") porId[a.id] = a;
  });
  const querTerritorio = /territ|direc/.test(t);
  const querFoto = /foto|tomada|imagem|revis|versao|ensaio/.test(t);
  if (querTerritorio && !querFoto) return { itens: territorios, lista: "territorios" };
  if (!querFoto && !c.revisoes.length) return { itens: territorios, lista: "territorios" };
  const ordemDaTomada = (r: RevisaoDePublicidade) => {
    const tomada = c.tomadas.find((x) => x.foto_tomada_id === r.foto_tomada_id || (!!r.tomada_id && x.id === r.tomada_id));
    return tomada ? tomada.ordem : 99;
  };
  // "A segunda tomada": ordem do plano; senão, a ordem da Revisão (sem decisão primeiro).
  const porTomada = /tomada/.test(t);
  const lista = c.revisoes
    .filter((r) => !!porId[r.id])
    .slice()
    .sort((x, y) => (porTomada ? ordemDaTomada(x) - ordemDaTomada(y) || y.versao - x.versao : (x.decisao ? 1 : 0) - (y.decisao ? 1 : 0)));
  const itens = lista.map((r) => {
    const a = porId[r.id];
    const ordem = ordemDaTomada(r);
    return { ref: a.ref, titulo: a.titulo, detalhe: [ordem < 99 ? `tomada ${ordem}` : "", a.detalhe || ""].filter(Boolean).join("; ") || null };
  });
  return { itens, lista: "fotos" };
}

/**
 * O "Ir para" da Publicidade (dono, 27/09: "quando termina ele dá o caminho
 * pra mim apertar e ir"). Conta só o que deu certo (antes de fazer, o que foi
 * pedido):
 * - fotos mandadas para a Mesa Ads ou a Mesa: abre o Estúdio de lá já com as
 *   fotos (o mesmo endereço do "Usar" da Mesa Foto);
 * - tomadas pedidas: etapa Tomadas; territórios: Direção; foto reprovada:
 *   Revisão; briefing e nome: a Campanha. Sempre com a campanha aberta.
 */
export function caminhoDaPublicidade(
  c: { client_id: string; id: string | null },
  acao: Pick<AcaoDoAgente, "itens" | "resultados">,
  opcoes: { abrirSozinho?: boolean } = {},
): CaminhoDoAgente | null {
  const feitos = acao.resultados && acao.resultados.length ? acao.resultados.filter((r) => r.ok) : null;
  const ops: string[] = [];
  const enviadas: Record<string, string[]> = { ads: [], mesa: [] };
  for (const i of acao.itens) {
    const r = feitos ? feitos.find((x) => x.ref === i.ref && x.operacao === i.operacao) : null;
    if (feitos && !r) continue;
    ops.push(i.operacao);
    if (r && (i.operacao === "mandar_para_ads" || i.operacao === "mandar_para_mesa")) {
      const ids = r.desfazer && Array.isArray(r.desfazer.imagem_ids) ? (r.desfazer.imagem_ids as unknown[]).map(String) : [];
      enviadas[i.operacao === "mandar_para_ads" ? "ads" : "mesa"].push(...ids);
    }
  }
  const destinoFeito = enviadas.ads.length ? "ads" : enviadas.mesa.length ? "mesa" : null;
  if (destinoFeito) {
    const destino = enderecoDoDestino(destinoFeito, c.client_id, Array.from(new Set(enviadas[destinoFeito])));
    const rotulo = destinoFeito === "ads" ? "Abrir no Estúdio da Mesa Ads" : "Abrir no Estúdio da Mesa";
    return opcoes.abrirSozinho ? { rotulo, destino, abrir_sozinho: true } : { rotulo, destino };
  }
  const tem = (op: string) => ops.indexOf(op) >= 0;
  const [etapa, rotulo] = tem("pedir_tomadas")
    ? ["tomadas", "Ver as tomadas"]
    : tem("propor_territorios") || tem("aprovar_territorio")
    ? ["direcao", "Ver a direção"]
    : tem("reprovar_foto") || tem("avaliar_revisao") || tem("aprovar_foto") || tem("refazer_foto")
    ? ["revisao", "Ver a revisão"]
    : tem("mandar_para_ads") || tem("mandar_para_mesa")
    ? ["envio", "Ver o envio"]
    : ["campanha", "Ver a campanha"];
  return caminhoNaArea("mesa_publicidade", { clientId: c.client_id, etapa, estado: { campanha: c.id }, rotulo, abrirSozinho: opcoes.abrirSozinho });
}

/** A resposta promete fazer sem trazer a lista? ("vou propor", "vou pedir"...). */
export function respostaPromete(resposta: unknown): boolean {
  return /\b(vou|irei|vamos) (j[aá] )?(propor|pedir|gerar|preparar|fazer|criar|refazer|mudar|trocar|aprovar|reprovar|mandar|enviar|avaliar|ajustar|montar)\b/i.test(String(resposta == null ? "" : resposta));
}
