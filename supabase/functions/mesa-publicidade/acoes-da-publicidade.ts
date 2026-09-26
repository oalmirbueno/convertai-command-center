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
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo.
 */
import {
  type AcaoDoAgente,
  type Alvo,
  type AlvoComApelido,
  blocoDosAlvos,
  esquemaDasAcoes,
  type ItemDaAcaoDoAgente,
  normalizarAcaoDoAgente,
  regraDasAcoes,
  type RegraDaOperacao,
} from "../_shared/acoes-do-agente.ts";
import { type CampanhaDePublicidade, ROTULO_DA_MUDANCA, type RevisaoDePublicidade } from "./regras.ts";

export const OPERACOES_DA_PUBLICIDADE = ["propor_territorios", "pedir_tomadas", "reprovar_foto", "mandar_para_ads", "mandar_para_mesa"];
export const ESQUEMA_DAS_ACOES_DA_PUBLICIDADE = esquemaDasAcoes(OPERACOES_DA_PUBLICIDADE);

/** Operações sem reverso (gastam IA ou reprovam na Mesa Foto). */
export const OPERACOES_SEM_REVERSO = ["propor_territorios", "pedir_tomadas", "reprovar_foto"];

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
};

export const DESCRICOES_DA_PUBLICIDADE: Record<string, string> = {
  propor_territorios: "ref = k1 (a campanha). O diretor propõe três territórios criativos novos (gasta IA). Pedido \"proponha 3 territórios\".",
  pedir_tomadas: "ref = o território APROVADO (t1..t4). Pede as seis tomadas à Mesa Foto com o produto das fontes (gasta IA). Pedido \"peça as 6 tomadas\".",
  reprovar_foto: "ref = foto (f1..fN) cujo detalhe diz \"produto mudou\". Reprova na Mesa Foto com o motivo. Pedido \"reprove as fotos que mudaram o produto\" vale para todas com \"produto mudou\" e sem decisão.",
  mandar_para_ads: "ref = foto APROVADA (f1..fN). Registra o envio para a Mesa Ads com a linhagem. Não aprova anúncio nem verba. Pedido \"mande as aprovadas para a Mesa Ads\" vale para todas aprovadas que ainda não estão lá.",
  mandar_para_mesa: "ref = foto APROVADA. Registra o envio para a Mesa (orgânico) com a linhagem.",
};

/** O pedido fala de alguma das ações? Só então as listas entram no prompt. */
export function pedeAcaoNaPublicidade(mensagem: string): boolean {
  return /(propo|territ|pe[cç]a|pedi|tomada|reprov|mud(ou|aram)|mand[ae]|envi[ae]|mesa ads|ads|aprovad)/i.test(String(mensagem || ""));
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
