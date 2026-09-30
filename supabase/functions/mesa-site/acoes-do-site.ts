/**
 * Ações do diretor de site (agente da Mesa Site, papel `site`), no contrato
 * comum de ../_shared/acoes-do-agente.ts: apelido em vez de id, cartão
 * Confirmar com o custo antes, item a item, Desfazer, travas e auditoria.
 *
 * Pedidos do dono que viram operação:
 * - "muda o hero para ..."             -> ajustar_secao (seção s1..; para = o pedido) — trabalho do motor, com Parar
 * - "constrói o FAQ e a chamada"       -> construir_secao (seção)                     — trabalho do motor, com Parar
 * - "para isso" / "cancela"            -> parar_trabalho (trabalho t1..)
 * - "desfaz a última mudança"          -> desfazer_trabalho (trabalho feito)          — volta o commit
 * - "fica com a opção 2"               -> escolher_copy (opção c1..c3), na hora, com Desfazer
 * - "revisa o site"                    -> revisar_site (x1), sem custo
 * - "gera outra copy mais direta"      -> gerar_conteudo (x1; para = pedido extra)
 * - "gera a imagem do hero com ..."    -> gerar_imagem (slot i1..; para = sujeito)
 * SIT2 (30/09):
 * - "monta o mapa do site"             -> montar_mapa (x1; para = tipo de site ou vazio) — Jev, custo mínimo
 * - "usa o preset editorial"           -> escolher_preset (e1..), na hora, com Desfazer
 * - "troca os depoimentos pelo FAQ"    -> trocar_secao (s..; para = tipo da biblioteca) — reconstrói se já estava construída
 * - "põe uma galeria na página Sobre"  -> adicionar_secao (p..; para = tipo da biblioteca)
 * - "tira a seção de números"          -> remover_secao (s..)
 * - "gera as imagens que faltam"       -> gerar_imagens_dos_slots (x1; para = qualidade ou vazio) — custo por imagem
 *
 * Sem import de Deno: o vitest lê este arquivo.
 */
import {
  type AcaoDoAgente,
  type AlvoComApelido,
  blocoDosAlvos,
  comApelido,
  esquemaDasAcoes,
  normalizarAcaoDoAgente,
  type RegraDaOperacao,
  regraDasAcoes,
} from "../_shared/acoes-do-agente.ts";
import { ehAberto, podeDesfazer, ROTULO_DO_ESTADO, ROTULO_DO_TIPO, type TrabalhoDoMotor } from "../_shared/motor-codigo.ts";
import { rotuloDaSecao, SLOTS_DE_IMAGEM } from "../_shared/site-metodo.ts";
import { BIBLIOTECA_DE_SECOES, PRESETS_DE_ESTILO, TIPOS_DE_SITE, tipoPedido } from "../_shared/site-biblioteca.ts";

export const OPERACOES_DO_SITE = [
  "ajustar_secao", "construir_secao", "parar_trabalho", "desfazer_trabalho", "escolher_copy", "revisar_site", "gerar_conteudo", "gerar_imagem",
  "montar_mapa", "escolher_preset", "trocar_secao", "adicionar_secao", "remover_secao", "gerar_imagens_dos_slots",
];
/** As que gastam modelo (o cartão mostra o custo antes; o do motor é o teto reservado). */
export const OPERACOES_COM_CUSTO = ["ajustar_secao", "construir_secao", "gerar_conteudo", "gerar_imagem", "montar_mapa", "trocar_secao", "gerar_imagens_dos_slots"];
/** As que viram trabalho do motor (a conversa mostra o estado e o Parar). */
export const OPERACOES_DO_MOTOR = ["ajustar_secao", "construir_secao", "desfazer_trabalho", "revisar_site"];

export const ESQUEMA_DAS_ACOES_DO_SITE = esquemaDasAcoes(OPERACOES_DO_SITE);

type AlvoDoSite = { id: string; titulo: string; detalhe?: string | null; dados?: Record<string, unknown> };

const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export type ListasDoAgente = {
  siteId: string;
  secoes: Array<{ id: string; construida: boolean; pagina?: string | null }>;
  trabalhos: TrabalhoDoMotor[];
  opcoesDeCopy: Array<{ headline: string; escolhida: boolean }>;
  /** SIT2: páginas do mapa, preset atual e quantas imagens o gerador pode fazer nos slots vazios. */
  paginas?: Array<{ id: string; titulo: string; secoes: number }>;
  presetAtual?: string | null;
  slotsParaGerar?: number;
};

export function alvosDoSite(l: ListasDoAgente): Array<AlvoComApelido<AlvoDoSite>> {
  const secoes = comApelido(l.secoes.map((s) => ({ id: s.id, titulo: rotuloDaSecao(s.id), detalhe: `${s.pagina ? `${s.pagina} · ` : ""}${s.construida ? "construída" : "ainda não construída"}`, dados: { construida: s.construida } })), "s");
  const trabalhos = comApelido(
    l.trabalhos.slice(0, 10).map((t) => ({
      id: t.id,
      titulo: `${ROTULO_DO_TIPO[t.tipo]}${t.instrucao ? `: ${umaLinha(t.instrucao, 80)}` : ""}`,
      detalhe: `${ROTULO_DO_ESTADO[t.estado]}${t.custo_usd ? ` · US$ ${t.custo_usd.toFixed(2)}` : ""}`,
      dados: { aberto: ehAberto(t.estado), desfaz: podeDesfazer(t) },
    })),
    "t",
  );
  const copys = comApelido(l.opcoesDeCopy.map((c, i) => ({ id: String(i), titulo: umaLinha(c.headline, 120) || `Opção ${i + 1}`, detalhe: c.escolhida ? "escolhida" : null, dados: { escolhida: c.escolhida } })), "c");
  const site = comApelido([{ id: l.siteId, titulo: "o site aberto" }], "x");
  const slots = comApelido(SLOTS_DE_IMAGEM.map((s) => ({ id: s.id, titulo: `imagem de ${s.rotulo.toLowerCase()}`, detalhe: s.proporcao })), "i");
  const paginas = comApelido((l.paginas || []).map((p) => ({ id: p.id, titulo: `página ${p.titulo}`, detalhe: `${p.secoes} seção(ões)`, dados: { secoes: p.secoes } })), "p");
  const presets = comApelido(PRESETS_DE_ESTILO.map((p) => ({ id: p.id, titulo: `preset ${p.rotulo}`, detalhe: p.id === l.presetAtual ? `atual · ${p.descricao}` : p.descricao, dados: { atual: p.id === l.presetAtual } })), "e");
  return [...secoes, ...trabalhos, ...copys, ...site, ...slots, ...paginas, ...presets];
}

export function regrasDoSite(): Record<string, RegraDaOperacao<AlvoDoSite>> {
  return {
    ajustar_secao: {
      rotulo: "ajustar a seção",
      alvos: ["s"],
      para: (bruto) => {
        const t = umaLinha(bruto, 1500);
        return t.length >= 4 ? t : null;
      },
      trava: (alvo) => (alvo.dados && alvo.dados.construida === false ? "Esta seção ainda não foi construída: peça para construir." : null),
    },
    construir_secao: {
      rotulo: "construir a seção",
      alvos: ["s"],
    },
    parar_trabalho: {
      rotulo: "parar",
      alvos: ["t"],
      trava: (alvo) => (alvo.dados && alvo.dados.aberto ? null : "Este trabalho já terminou."),
    },
    desfazer_trabalho: {
      rotulo: "desfazer",
      alvos: ["t"],
      trava: (alvo) => (alvo.dados && alvo.dados.desfaz ? null : "Este trabalho não tem o que desfazer."),
    },
    escolher_copy: {
      rotulo: "ficar com a opção",
      alvos: ["c"],
      direta: true,
      trava: (alvo) => (alvo.dados && alvo.dados.escolhida ? "Esta opção já é a escolhida." : null),
    },
    revisar_site: { rotulo: "revisar", alvos: ["x"] },
    gerar_conteudo: { rotulo: "gerar 3 opções de conteúdo para", alvos: ["x"], para: (bruto) => umaLinha(bruto, 600) || "sem pedido extra" },
    gerar_imagem: {
      rotulo: "gerar a",
      alvos: ["i"],
      repete: true,
      para: (bruto) => {
        const t = umaLinha(bruto, 400);
        return t.length >= 4 ? t : null;
      },
    },
    montar_mapa: {
      rotulo: "montar o mapa de",
      alvos: ["x"],
      combina: true,
      // Tipo de site pedido (id ou nome) ou vazio: o Jev decide pelo briefing.
      para: (bruto) => {
        const t = umaLinha(bruto, 60).toLowerCase();
        if (!t) return "auto";
        const achado = TIPOS_DE_SITE.find((x) => x.id === t || x.rotulo.toLowerCase() === t || t.indexOf(x.rotulo.toLowerCase()) >= 0);
        return achado ? achado.id : "auto";
      },
    },
    escolher_preset: {
      rotulo: "usar o",
      alvos: ["e"],
      direta: true,
      trava: (alvo) => (alvo.dados && alvo.dados.atual ? "Este já é o preset do site." : null),
    },
    trocar_secao: {
      rotulo: "trocar a seção",
      alvos: ["s"],
      para: (bruto, alvo) => {
        const tipo = tipoPedido(bruto);
        const lib = tipo ? BIBLIOTECA_DE_SECOES.find((x) => x.id === tipo) : null;
        return lib && !lib.global && tipo !== alvo.id ? tipo : null;
      },
      trava: (alvo) => (alvo.id === "topo" || alvo.id === "rodape" ? "Topo e rodapé são do layout: ajuste em vez de trocar." : null),
    },
    adicionar_secao: {
      rotulo: "acrescentar na",
      alvos: ["p"],
      repete: true,
      para: (bruto) => {
        const tipo = tipoPedido(bruto);
        const lib = tipo ? BIBLIOTECA_DE_SECOES.find((x) => x.id === tipo) : null;
        return lib && !lib.global ? tipo : null;
      },
      trava: (alvo) => (alvo.dados && Number(alvo.dados.secoes) >= 14 ? "A página já tem 14 seções." : null),
    },
    remover_secao: {
      rotulo: "tirar do mapa",
      alvos: ["s"],
      trava: (alvo) => (alvo.id === "topo" || alvo.id === "rodape" ? "Topo e rodapé ficam: são do layout." : null),
    },
    gerar_imagens_dos_slots: {
      rotulo: "gerar as imagens que faltam em",
      alvos: ["x"],
      combina: true,
      para: (bruto) => {
        const t = umaLinha(bruto, 20).toLowerCase();
        return t === "baixa" || t === "alta" ? t : "media";
      },
    },
  };
}

export const DESCRICOES_DAS_ACOES = {
  ajustar_secao: "muda uma seção já construída (para = o que mudar, com as palavras da equipe). Vira trabalho do motor de código; custa modelo.",
  construir_secao: "constrói uma seção ainda não construída (ou de novo, do zero). Uma por item; custa modelo.",
  parar_trabalho: "para um trabalho do motor que está na fila ou rodando.",
  desfazer_trabalho: "volta o código ao ponto de antes de um trabalho terminado (volta o commit).",
  escolher_copy: "escolhe uma das 3 opções de conteúdo (c1..c3). Sem custo.",
  revisar_site: "roda a revisão de acessibilidade, celular e SEO no site construído. Sem custo de modelo.",
  gerar_conteudo: "gera 3 opções novas de conteúdo (para = pedido extra ou vazio). Custa modelo.",
  gerar_imagem: "gera uma imagem com o GPT Image para o slot (para = o sujeito da cena). Nunca logo nem foto real: essas entram pelo código.",
  montar_mapa: `monta o mapa do site (páginas e seções) pelo tipo e pelo briefing; o Jev escolhe as seções opcionais (para = ${TIPOS_DE_SITE.map((t) => t.id).join(", ")} ou vazio para o Jev decidir). Custo mínimo.`,
  escolher_preset: "troca o preset de estilo (e1..) e o DNA dele; a paleta continua a da marca. Sem custo.",
  trocar_secao: `troca a seção por outra da biblioteca no mesmo lugar (para = id da biblioteca: ${BIBLIOTECA_DE_SECOES.filter((x) => !x.global).map((x) => x.id).join(", ")}). Se a antiga já estava construída, a nova entra na fila do motor (custa o teto de uma seção).`,
  adicionar_secao: "acrescenta uma seção da biblioteca na página (p..; para = id da biblioteca), na ordem canônica. Sem custo (construir é outro pedido).",
  remover_secao: "tira a seção do mapa (o código fica guardado). Topo e rodapé não saem.",
  gerar_imagens_dos_slots: "gera com o GPT Image as imagens que faltam nos slots do mapa (até 4 por vez; para = baixa, media ou alta). Slot de foto real fica de fora.",
};

export function blocoDasAcoesDoSite(l: ListasDoAgente): string {
  const alvos = alvosDoSite(l);
  const por = (p: string) => alvos.filter((a) => a.ref.charAt(0) === p);
  return [
    blocoDosAlvos("SEÇÕES DO SITE", por("s")),
    blocoDosAlvos("TRABALHOS DO MOTOR (mais novos primeiro)", por("t"), "nenhum ainda."),
    blocoDosAlvos("OPÇÕES DE CONTEÚDO", por("c"), "nenhuma gerada ainda."),
    blocoDosAlvos("SITE", por("x")),
    blocoDosAlvos("SLOTS DE IMAGEM", por("i")),
    blocoDosAlvos("PÁGINAS DO MAPA", por("p"), "o mapa ainda não foi salvo (uma página)."),
    blocoDosAlvos("PRESETS DE ESTILO", por("e")),
    `IMAGENS QUE O GERADOR PODE FAZER NOS SLOTS VAZIOS: ${l.slotsParaGerar ?? 0}`,
    regraDasAcoes(DESCRICOES_DAS_ACOES),
  ].join("\n");
}

/**
 * Lê as ações do modelo. O custo do cartão: o teto sugerido de cada trabalho
 * de código (reservado na carteira) mais a estimativa de conteúdo e imagem.
 */
export function normalizarAcoesDoSite(
  bruto: unknown,
  l: ListasDoAgente,
  clientId: string,
  custos: { ajustar: number; construir: number; conteudo: number; imagem: number; mapa?: number },
  anexos: Array<{ bucket: string; path: string; nome: string }> = [],
  id?: string,
): AcaoDoAgente | null {
  const acao = normalizarAcaoDoAgente(bruto, alvosDoSite(l), regrasDoSite(), {
    agente: "site",
    id: id || `site-${Date.now().toString(36)}`,
    contexto: { client_id: clientId, site_id: l.siteId, anexos: anexos.slice(0, 6) },
    rotuloDoPara: (operacao, para) => (operacao === "gerar_conteudo" && para === "sem pedido extra" ? null : null),
  });
  if (!acao) return null;
  let custo = 0;
  for (const i of acao.itens) {
    if (i.operacao === "ajustar_secao") custo += custos.ajustar;
    else if (i.operacao === "construir_secao") custo += custos.construir;
    else if (i.operacao === "gerar_conteudo") custo += custos.conteudo;
    else if (i.operacao === "gerar_imagem") custo += custos.imagem;
    else if (i.operacao === "montar_mapa") custo += custos.mapa || 0;
    else if (i.operacao === "gerar_imagens_dos_slots") custo += custos.imagem * Math.max(1, Math.min(4, l.slotsParaGerar || 0));
    else if (i.operacao === "trocar_secao") {
      const alvo = l.secoes.find((x) => x.id === i.alvo_id);
      if (alvo && alvo.construida) custo += custos.construir;
    }
  }
  acao.custo_estimado_usd = Math.round(custo * 1e6) / 1e6;
  // Parar e revisar não têm volta pelo cartão.
  if (acao.itens.length && acao.itens.every((i) => i.operacao === "parar_trabalho" || i.operacao === "revisar_site")) acao.sem_desfazer = true;
  return acao;
}

/** "Ir para" depois de feito: a etapa que mostra o resultado. */
export function caminhoDoSite(clientId: string, siteId: string, acao: Pick<AcaoDoAgente, "itens">): { rotulo: string; destino: string } {
  const ops = acao.itens.map((i) => i.operacao);
  const etapa = ops.some((o) => o === "montar_mapa" || o === "escolher_preset" || o === "adicionar_secao" || o === "remover_secao" || o === "trocar_secao")
    ? "direcao"
    : ops.some((o) => o === "escolher_copy" || o === "gerar_conteudo")
    ? "conteudo"
    : ops.some((o) => o === "gerar_imagem" || o === "gerar_imagens_dos_slots")
      ? "imagens"
      : ops.some((o) => o === "revisar_site")
        ? "revisao"
        : "construcao";
  const rotulo = etapa === "direcao" ? "Abrir a direção" : etapa === "conteudo" ? "Abrir o conteúdo" : etapa === "imagens" ? "Abrir as imagens" : etapa === "revisao" ? "Abrir a revisão" : "Abrir a construção";
  return { rotulo, destino: `/mesa-site?client=${clientId}&site=${siteId}&etapa=${etapa}` };
}
