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

export const OPERACOES_DA_PUBLICIDADE = ["propor_territorios", "pedir_tomadas", "reprovar_foto", "mandar_para_ads", "mandar_para_mesa", "editar_briefing", "renomear_campanha", "aprovar_territorio"];
export const ESQUEMA_DAS_ACOES_DA_PUBLICIDADE = esquemaDasAcoes(OPERACOES_DA_PUBLICIDADE);

/** Operações sem reverso (gastam IA ou reprovam na Mesa Foto). */
export const OPERACOES_SEM_REVERSO = ["propor_territorios", "pedir_tomadas", "reprovar_foto", "aprovar_territorio"];

/** Campos do briefing que o agente troca por pedido (texto simples; a oferta entra como hipótese). */
export const CAMPOS_EDITAVEIS_DO_BRIEFING: Record<string, string> = {
  objetivo_texto: "objetivo",
  publico: "público",
  ocasiao: "ocasião",
  tom: "tom",
  destino: "destino",
  proibido: "o que é proibido",
  oferta: "oferta",
};

/** "publico: mulheres de 30 a 45" -> { campo, valor }. Campo fora da lista ou valor vazio: null. */
export function lerEdicaoDoBriefing(bruto: unknown): { campo: string; valor: string } | null {
  const s = String(bruto == null ? "" : bruto);
  const i = s.indexOf(":");
  if (i <= 0) return null;
  const campo = s.slice(0, i).trim().toLowerCase().replace(/\s+/g, "_");
  const valor = s.slice(i + 1).replace(/\s+/g, " ").trim().slice(0, 600);
  if (!Object.prototype.hasOwnProperty.call(CAMPOS_EDITAVEIS_DO_BRIEFING, campo) || valor.length < 2) return null;
  return { campo, valor };
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
    const destinos = c.encaminhamentos.filter((e) => e.imagem_id && e.imagem_id === r.imagem_id).map((e) => e.destino);
    const mud = r.avaliacao.mudancas.map((m) => ROTULO_DA_MUDANCA[m]).join(", ");
    saida.push({
      id: r.id,
      ref: `f${i + 1}`,
      titulo: tituloDaFoto(c, r),
      detalhe: [ROTULO_DO_VEREDITO[r.avaliacao.veredito] || r.avaliacao.veredito, mud, r.decisao ? `decisão: ${r.decisao}` : "sem decisão", destinos.length ? `já em ${destinos.join(" e ")}` : ""]
        .filter(Boolean)
        .join("; "),
      dados: { tipo: "foto", veredito: r.avaliacao.veredito, decisao: r.decisao, imagem_id: r.imagem_id, destinos },
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
};

export const DESCRICOES_DA_PUBLICIDADE: Record<string, string> = {
  propor_territorios: "ref = k1 (a campanha). O diretor propõe três territórios criativos novos (gasta IA). Pedido \"proponha 3 territórios\".",
  pedir_tomadas: "ref = o território APROVADO (t1..t4). Pede as seis tomadas à Mesa Foto com o produto das fontes (gasta IA). Pedido \"peça as 6 tomadas\".",
  reprovar_foto: "ref = foto (f1..fN) cujo detalhe diz \"produto mudou\". Reprova na Mesa Foto com o motivo. Pedido \"reprove as fotos que mudaram o produto\" vale para todas com \"produto mudou\" e sem decisão.",
  mandar_para_ads: "ref = foto APROVADA (f1..fN). Registra o envio para a Mesa Ads com a linhagem. Não aprova anúncio nem verba. Pedido \"mande as aprovadas para a Mesa Ads\" vale para todas aprovadas que ainda não estão lá.",
  mandar_para_mesa: "ref = foto APROVADA. Registra o envio para a Mesa (orgânico) com a linhagem.",
  editar_briefing: "ref = k1. para = \"campo: valor novo\", campo um de objetivo_texto, publico, ocasiao, tom, destino, proibido, oferta (um item por campo). Grava versão nova do briefing. Oferta sem fonte fica como hipótese.",
  renomear_campanha: "ref = k1. para = o nome novo da campanha.",
  aprovar_territorio: "ref = território proposto (t1..t4). Aprova e monta o plano das seis tomadas (sem custo). Pedido \"aprove o território X\".",
};

/** O pedido fala de alguma das ações? Só então as listas entram no prompt. */
export function pedeAcaoNaPublicidade(mensagem: string): boolean {
  return /(propo|territ|pe[cç]a|pedi|tomada|reprov|mud(ou|aram)|mand[ae]|envi[ae]|mesa ads|ads|aprov|briefing|renome|nome da campanha|p[uú]blico|ocasi|oferta|proibid|tom d[aoe]|troqu?e|mude|ajust)/i.test(String(mensagem || ""));
}

export function blocoDasAcoesDaPublicidade(c: CampanhaDePublicidade): string {
  return `${blocoDosAlvos("CAMPANHA, TERRITÓRIOS E FOTOS", alvosDaPublicidade(c), "nenhum (abra uma campanha).")}\n${regraDasAcoes(DESCRICOES_DA_PUBLICIDADE)}`;
}

export function normalizarAcoesDaPublicidade(bruto: unknown, c: CampanhaDePublicidade, id?: string): AcaoDoAgente | null {
  return normalizarAcaoDoAgente(bruto, alvosDaPublicidade(c), REGRAS_DA_PUBLICIDADE, {
    agente: "publicidade",
    id: id || `publicidade-${Date.now().toString(36)}`,
    contexto: { client_id: c.client_id, campanha_id: c.id },
    semDesfazer: (itens: ItemDaAcaoDoAgente[]) => itens.every((i) => OPERACOES_SEM_REVERSO.indexOf(i.operacao) >= 0),
  });
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
    : tem("reprovar_foto")
    ? ["revisao", "Ver a revisão"]
    : tem("mandar_para_ads") || tem("mandar_para_mesa")
    ? ["envio", "Ver o envio"]
    : ["campanha", "Ver a campanha"];
  return caminhoNaArea("mesa_publicidade", { clientId: c.client_id, etapa, estado: { campanha: c.id }, rotulo, abrirSozinho: opcoes.abrirSozinho });
}
