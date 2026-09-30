/**
 * "Preencher com IA" do briefing interno (frente BRF2, 30/09/2026): a equipe
 * cola a reunião ou a conversa, marca o site e o Instagram do cliente, escolhe
 * o modelo e recebe uma PRÉVIA das respostas. Nada é gravado sem a pessoa ver:
 * a prévia volta para a tela, a pessoa aplica tudo ou campo a campo e pode
 * desfazer. O link só vai para o cliente depois que a equipe revisou.
 *
 * Por dentro usa a peça comum da frente PIA (_shared/preencher-com-ia.ts):
 * esquema estrito montado dos campos, pedido com as fontes e a conferência
 * "nada inventado" (número e nome próprio só se estiverem no material). Aqui
 * fica só o que é do briefing:
 * - de pergunta do briefing para campo da peça comum (escolha, lista, número
 *   da escala, texto) e de volta para o formato da resposta do link;
 * - a reunião longa entra em partes (cada fonte da peça comum tem teto);
 * - escolha múltipla só com as opções da pergunta (o resto vira "Outro"
 *   quando a pergunta aceita, senão sai com aviso);
 * - pergunta de arquivo e de lista de materiais fica para o cliente.
 *
 * Puro: sem Deno e sem npm. Sem travessão.
 */

import {
  type AnexoDoBriefing,
  type CampoDoBriefing,
  campoRespondido,
  camposDoModelo,
  chaveDoOutro,
  type ModeloDeBriefing,
  type Respostas,
  urlValida,
} from "./briefing-modelos.ts";
import {
  type CampoParaPreencher,
  type FonteLida,
  limparResposta,
  montarPedido,
  normalizarParaComparar,
  semTravessao,
  tetoDeSaida,
  tokensDaEstimativa,
} from "./preencher-com-ia.ts";

export const TIPOS_QUE_A_IA_PREENCHE = ["text", "textarea", "single-chip", "multi-chip", "scale", "url", "date", "confirm", "reference"];

/** Teto do material colado (reunião, conversa) e o tamanho de cada parte que vai ao modelo. */
export const MAX_MATERIAL = 24_000;
export const PARTE_DO_MATERIAL = 4_800;
export const MAX_SITE = 5_000;
export const MAX_INSTAGRAM = 4_000;

// ------------------------------------------------------------------ campos

function campoDaPecaComum(c: CampoDoBriefing, respostas: Respostas): CampoParaPreencher {
  const base = { chave: c.key, rotulo: c.pergunta.slice(0, 120), valorAtual: respostas[c.key] };
  switch (c.tipo) {
    case "single-chip":
      return { ...base, tipo: "escolha", opcoes: (c.opcoes || []).slice(0, 40) };
    case "multi-chip":
      return {
        ...base,
        tipo: "lista",
        maximo: c.maxSelect || (c.opcoes || []).length || 8,
        dica: `Use só estas opções, escritas igual: ${(c.opcoes || []).join(" | ")}${c.outro ? ". Se o material citar outra, escreva a outra como um item à parte" : ""}`.slice(0, 400),
      };
    case "scale":
      return { ...base, tipo: "numero", dica: `Escala de 1, 2, 3, 4 ou 5 (1 = ${c.polos ? c.polos[0] : "um polo"}, 5 = ${c.polos ? c.polos[1] : "o outro"})` };
    case "reference":
      return { ...base, tipo: "lista", maximo: 10, dica: "Só links (URL completa) citados no material, um por item" };
    case "url":
      return c.multiplo
        ? { ...base, tipo: "lista", maximo: 8, dica: "Só endereços (URL ou @) citados no material, um por item" }
        : { ...base, tipo: "texto", maximo: 400, dica: "Só o endereço (URL ou @), igual ao material" };
    case "date":
      return { ...base, tipo: "texto", maximo: 10, dica: "Data no formato AAAA-MM-DD, só se o material disser a data" };
    case "textarea":
      return { ...base, tipo: "texto_longo", maximo: c.maxChars || 1200, dica: "Na voz do cliente, frases curtas" };
    default:
      return { ...base, tipo: "texto", maximo: c.maxChars || 400 };
  }
}

/** Os campos que a IA pode preencher, no formato da peça comum (vazios, a menos que substituir). */
export function camposParaIa(m: ModeloDeBriefing, respostas: Respostas, anexos: AnexoDoBriefing[] = [], substituir = false): CampoParaPreencher[] {
  return camposDoModelo(m)
    .filter((c) => TIPOS_QUE_A_IA_PREENCHE.indexOf(c.tipo) >= 0)
    .filter((c) => substituir || !campoRespondido(c, respostas, anexos))
    .slice(0, 40)
    .map((c) => campoDaPecaComum(c, respostas));
}

// ------------------------------------------------------------------ fontes

export type MaterialDoPreenchimento = {
  reuniao?: string | null;
  conversa?: string | null;
  site?: string | null;
  instagram?: string | null;
  contexto?: string | null;
};

/**
 * O material como fontes da peça comum: a reunião e a conversa em partes
 * (cada fonte tem teto no pedido), o site, o Instagram e o contexto do painel.
 */
export function fontesDoMaterial(m: MaterialDoPreenchimento): { fontes: FonteLida[]; avisos: string[] } {
  const fontes: FonteLida[] = [];
  const avisos: string[] = [];
  const emPartes = (rotulo: string, bruto: string | null | undefined) => {
    let t = String(bruto || "").replace(/\r\n/g, "\n").trim();
    if (!t) return;
    if (t.length > MAX_MATERIAL) {
      avisos.push(`${rotulo}: só os primeiros ${MAX_MATERIAL} caracteres entraram.`);
      t = t.slice(0, MAX_MATERIAL);
    }
    const partes = Math.ceil(t.length / PARTE_DO_MATERIAL);
    for (let i = 0; i < partes; i++) {
      fontes.push({ id: "arquivos", rotulo: partes > 1 ? `${rotulo} (parte ${i + 1} de ${partes})` : rotulo, texto: t.slice(i * PARTE_DO_MATERIAL, (i + 1) * PARTE_DO_MATERIAL) });
    }
  };
  emPartes("Reunião", m.reuniao);
  emPartes("Conversa", m.conversa);
  const site = String(m.site || "").trim();
  if (site) fontes.push({ id: "arquivos", rotulo: "Site do cliente", texto: site.slice(0, MAX_SITE) });
  const ig = String(m.instagram || "").trim();
  if (ig) fontes.push({ id: "arquivos", rotulo: "Instagram do cliente", texto: ig.slice(0, MAX_INSTAGRAM) });
  const ctx = String(m.contexto || "").trim();
  if (ctx) fontes.push({ id: "contexto", rotulo: "Contexto do painel", texto: ctx.slice(0, 4_000) });
  return { fontes, avisos };
}

/** Quantos caracteres de material entram de fato. */
export const caracteresDasFontes = (fontes: FonteLida[]) => fontes.reduce((s, f) => s + f.texto.length, 0);

/** Pedido ao modelo (sistema, mensagem e esquema estrito da peça comum). */
export function pedidoDoPreenchimento(m: ModeloDeBriefing, campos: CampoParaPreencher[], fontes: FonteLida[], substituir = false) {
  return montarPedido({
    papel: "briefing",
    campos,
    fontes,
    contexto: `Briefing "${m.titulo}". Responda como o cliente responderia, só com o que o material diz. Pergunta que o material não responde fica null.`,
    substituir,
  });
}

/** Tokens estimados antes (custo pela tabela do catálogo). */
export function tamanhoDoPreenchimento(campos: CampoParaPreencher[], caracteresDoMaterial: number): { entrada: number; saida: number } {
  const t = tokensDaEstimativa(campos, [], caracteresDoMaterial);
  return { entrada: t.pedido, saida: tetoDeSaida(campos) };
}

// ------------------------------------------------------------------ de volta para o formato do link

function opcaoIgual(valor: string, opcoes: string[]): string | null {
  const v = normalizarParaComparar(valor).trim();
  for (const o of opcoes) if (normalizarParaComparar(o).trim() === v) return o;
  return null;
}

export type ResultadoDoPreenchimentoDoBriefing = {
  valores: Record<string, unknown>;
  fontes: string[];
  avisos: string[];
};

/**
 * Confere a resposta do modelo (regras da peça comum) e devolve os valores no
 * formato das respostas do link: escolha múltipla com as opções da pergunta,
 * escala inteira de 1 a 5, data AAAA-MM-DD, endereços válidos.
 */
export function limparPreenchimento(
  json: unknown,
  modelo: ModeloDeBriefing,
  campos: CampoParaPreencher[],
  pedido: ReturnType<typeof pedidoDoPreenchimento>,
  fontes: FonteLida[],
  substituir = false,
): ResultadoDoPreenchimentoDoBriefing {
  const limpo = limparResposta(json, { papel: "briefing", mapa: pedido.esquema.mapa, fontes, substituir });
  const saida: ResultadoDoPreenchimentoDoBriefing = { valores: {}, fontes: limpo.fontes, avisos: limpo.avisos.slice() };
  const doModelo = camposDoModelo(modelo);
  campos.forEach((cp) => {
    const v = limpo.valores[cp.chave];
    if (v === undefined) return;
    const c = doModelo.find((x) => x.key === cp.chave);
    if (!c) return;
    const aviso = (t: string) => saida.avisos.push(`${c.pergunta.slice(0, 60)}: ${t}`);
    switch (c.tipo) {
      case "single-chip":
        if (typeof v === "string") saida.valores[c.key] = v;
        return;
      case "multi-chip": {
        const itens = (Array.isArray(v) ? v : [v]).map((x) => semTravessao(String(x || "").trim())).filter(Boolean);
        const achadas: string[] = [];
        const outras: string[] = [];
        itens.forEach((p) => {
          const a = opcaoIgual(p, c.opcoes || []);
          if (a && achadas.indexOf(a) < 0) achadas.push(a);
          else if (!a) outras.push(p);
        });
        const lista = c.maxSelect ? achadas.slice(0, c.maxSelect) : achadas;
        if (outras.length && c.outro && (!c.maxSelect || lista.length < c.maxSelect)) {
          saida.valores[c.key] = lista.concat("Outro");
          saida.valores[chaveDoOutro(c.key)] = outras.join(", ").slice(0, 200);
        } else {
          if (outras.length) aviso(`ficou de fora o que não é opção (${outras.join(", ").slice(0, 60)}).`);
          if (lista.length) saida.valores[c.key] = lista;
        }
        return;
      }
      case "scale": {
        const n = Math.round(Number(v));
        if (n >= 1 && n <= 5) saida.valores[c.key] = n;
        return;
      }
      case "date": {
        const t = String(v).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(t)) saida.valores[c.key] = t;
        else aviso("a data não veio no formato AAAA-MM-DD e ficou de fora.");
        return;
      }
      case "reference": {
        const links = (Array.isArray(v) ? v : [v]).map((x) => String(x || "").trim()).filter((x) => urlValida(x)).slice(0, 10);
        if (links.length) saida.valores[c.key] = links.map((link) => ({ link }));
        return;
      }
      case "url": {
        const itens = (Array.isArray(v) ? v : [v]).map((x) => String(x || "").trim()).filter((x) => urlValida(x));
        if (!itens.length) {
          aviso("o endereço não é válido e ficou de fora.");
          return;
        }
        saida.valores[c.key] = c.multiplo ? itens.slice(0, 8) : itens[0];
        return;
      }
      default:
        if (typeof v === "string" && v.trim()) saida.valores[c.key] = v.trim().slice(0, c.maxChars || (c.tipo === "textarea" ? 1200 : 400));
    }
  });
  return saida;
}

/** Os valores de antes das chaves que vão mudar (para o Desfazer). null = não existia. */
export function anterioresDe(respostas: Respostas, valores: Record<string, unknown>): Record<string, unknown> {
  const antes: Record<string, unknown> = {};
  Object.keys(valores).forEach((k) => {
    antes[k] = Object.prototype.hasOwnProperty.call(respostas, k) ? respostas[k] : null;
  });
  return antes;
}
