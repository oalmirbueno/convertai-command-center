/**
 * mesa-identidade: a Mesa Identidade Visual e Naming (/mesa-identidade),
 * frente IDV (30/09/2026). Contrato: docs/mesa-identidade/CONTRATO.md.
 *
 * POST { acao, ... }, só equipe com acesso ao cliente. Ação com IA devolve
 * custo_usd e saldo_usd (o custo aparece antes, na tela, pela ação estimar);
 * erro sai como { error, mensagem } (nas ações com fôlego o status real vai
 * em status_http).
 *
 * Projeto e etapas (sem IA):
 * - projeto_listar { client_id, marca_id?, arquivados? } -> { projetos }
 * - projeto_criar { client_id, marca_id?, modo: zero|rebranding, titulo?, com_naming? } -> { projeto }
 * - projeto_salvar { projeto_id, versao?, parte?, valor?, substituir?, titulo?, com_naming? } -> { projeto } (409 versao_mudou)
 * - etapa_concluir { projeto_id, etapa } -> { projeto } (409 etapa_incompleta com { falta })
 * - etapa_reabrir { projeto_id, etapa } -> { projeto }
 * - projeto_arquivar { projeto_id, arquivar } -> { projeto }
 * - briefing_montar { projeto_id } -> { briefing } (briefing do cliente + contexto da marca; não grava)
 * - pesquisa_referencias { projeto_id } -> { referencias }
 * Com IA (custo antes):
 * - estimar { client_id, acao_alvo: naming|conceito|pesquisa|conversa|imagem, modelo_id? } -> { estimativa_usd, modelo_id }
 * - pesquisa_ia { projeto_id, pedido?, modelo_id? } -> { projeto, pesquisa }
 * - conceito_gerar { projeto_id, quantidade: 2|3, pedido?, modelo_id? } -> { projeto }
 * - conceito_imagem { projeto_id, caminho_id, modelo_id? } -> { projeto, imagem } (inspiração, nunca a logo)
 * - conceito_escolher { projeto_id, caminho_id } -> { projeto } (sem IA)
 * Naming (também da Mesa → Campanhas):
 * - naming_gerar { client_id, marca_id?, projeto_id?, campanha_id?, alvo, tecnicas[], quantidade, criterios[], pedido?, modelo_id? } -> { rodada, aviso_jev }
 * - naming_listar { client_id, projeto_id?, campanha_id? } -> { rodadas }
 * - naming_conferir | naming_finalistas { ids[] } | naming_escolher { candidato_id } | naming_arquivar { arquivar }
 * - naming_pdf_compartilhar { rodada_id } -> { file_id, revisao_solicitada }
 * - naming_mensagem { rodada_id } -> { mensagem, link_whatsapp } ; naming_registrar_grupo { rodada_id }
 * Estratégia e propostas (IDV2, com IA e custo antes; modelo_id escolhido na tela):
 * - estrategia_propor { projeto_id, modelo_id?, usar_web?, instrucao? } -> { proposta, fontes, avisos } (não grava)
 * - paletas_propor | fontes_propor { projeto_id, modelo_id? } -> { projeto, propostas }
 * - slogans_gerar { projeto_id, modelo_id?, quantos?, pedido? } -> { projeto, slogans } ; slogan_escolher { projeto_id, slogan_id?, texto? }
 * Naming (IDV2): naming_idiomas { rodada_id, modelo_id? } ; naming_votacao_abrir | naming_votacao_fechar | naming_votos { rodada_id }
 * - naming_votar { rodada_id, votos: [{ candidato_id, nota }], comentario? } (voto da equipe)
 * Moodboard: moodboard_web { projeto_id, busca, pagina? } -> { itens } (Openverse, sem custo)
 * Brandbook e kit:
 * - brandbook_montar { projeto_id, modelo } | brandbook_salvar { brandbook_id, dados, modelo?, nota? } | brandbook_listar { projeto_id }
 * - brandbook_compartilhar { brandbook_id } -> { file_id } ; brandbook_publicar / brandbook_revogar { brandbook_id }
 * - kit_sugerir { projeto_id } -> { mensagem_id, anexo } (cartão com Confirmar)
 * Diretor de marca (contrato comum das ações confirmadas):
 * - agente_conversar { client_id, mensagem, projeto_id?, conversa_id?, nova_conversa? }
 * - agente_historico { client_id } ; executar_acao_agente { mensagem_id, acao_id?, descartar?, parar? } ; desfazer_acao_agente { mensagem_id, acao_id? }
 * - aprendizado_esquecer / aprendizado_guardar
 *
 * Regras: logo pelo código (a final é arquivo real da equipe; IA só inspira);
 * julgamento pelo Jev (ranking de nomes e recomendação de caminho, como
 * aviso); sem laço de correção; nada vai ao cliente nem é publicado sem a
 * equipe; apagar = arquivar. Sem travessão.
 */

import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { rotasDoAprendizado } from "../_shared/aprendizado-das-mesas.ts";
import { corsHeaders, type Chamador, garantirAcesso, identificar, idDe, json, respostaDeErro, servico } from "./comum.ts";
import {
  briefingMontar,
  conceitoEscolher,
  conceitoGerar,
  conceitoImagem,
  estimativaDa,
  etapaConcluir,
  etapaReabrir,
  pesquisaIa,
  pesquisaReferencias,
  projetoArquivar,
  projetoCriar,
  projetoListar,
  projetoSalvar,
} from "./projeto-acoes.ts";
import {
  namingArquivar,
  namingConferir,
  namingEscolher,
  namingFinalistas,
  namingGerar,
  namingListar,
  namingMensagem,
  namingPdfCompartilhar,
  namingRegistrarGrupo,
} from "./naming-acoes.ts";
import { brandbookCompartilhar, brandbookListar, brandbookMontar, brandbookPublicar, brandbookRevogar, brandbookSalvar, kitSugerir } from "./brandbook-acoes.ts";
import { agenteConversar, agenteHistorico, conversaDoAgente, desfazerAcao, executarAcao } from "./diretor.ts";
import { estimativaDaProposta, estrategiaPropor, fontesPropor, paletasPropor, sloganEscolher, slogansGerar } from "./estrategia-acoes.ts";
import { moodboardWeb, namingIdiomas, namingVotacaoAbrir, namingVotacaoFechar, namingVotar, namingVotos } from "./naming-v2-acoes.ts";

async function estimar(ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await garantirAcesso(ch, clientId);
  const alvo = String(corpo.acao_alvo || "conversa");
  const proposta = await estimativaDaProposta(alvo, corpo.modelo_id);
  if (proposta) return json({ ...proposta, custo_usd: 0 });
  if (["naming", "conceito", "pesquisa", "conversa", "imagem"].indexOf(alvo) < 0) return json({ error: "acao_alvo_invalida", mensagem: "Ação a estimar desconhecida." }, 400);
  return json({ ...(await estimativaDa(alvo, corpo.modelo_id)), custo_usd: 0 });
}

const ACOES: Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>> = {
  estimar,
  projeto_listar: projetoListar,
  projeto_criar: projetoCriar,
  projeto_salvar: projetoSalvar,
  etapa_concluir: etapaConcluir,
  etapa_reabrir: etapaReabrir,
  projeto_arquivar: projetoArquivar,
  briefing_montar: briefingMontar,
  pesquisa_referencias: pesquisaReferencias,
  pesquisa_ia: pesquisaIa,
  conceito_gerar: conceitoGerar,
  conceito_escolher: conceitoEscolher,
  conceito_imagem: conceitoImagem,
  naming_gerar: namingGerar,
  naming_listar: namingListar,
  naming_conferir: namingConferir,
  naming_finalistas: namingFinalistas,
  naming_escolher: namingEscolher,
  naming_arquivar: namingArquivar,
  naming_pdf_compartilhar: namingPdfCompartilhar,
  naming_mensagem: namingMensagem,
  naming_registrar_grupo: namingRegistrarGrupo,
  estrategia_propor: estrategiaPropor,
  paletas_propor: paletasPropor,
  fontes_propor: fontesPropor,
  slogans_gerar: slogansGerar,
  slogan_escolher: sloganEscolher,
  naming_idiomas: namingIdiomas,
  naming_votacao_abrir: namingVotacaoAbrir,
  naming_votacao_fechar: namingVotacaoFechar,
  naming_votar: namingVotar,
  naming_votos: namingVotos,
  moodboard_web: moodboardWeb,
  brandbook_montar: brandbookMontar,
  brandbook_listar: brandbookListar,
  brandbook_salvar: brandbookSalvar,
  brandbook_compartilhar: brandbookCompartilhar,
  brandbook_publicar: brandbookPublicar,
  brandbook_revogar: brandbookRevogar,
  kit_sugerir: (ch, corpo) => kitSugerir(ch, corpo, (c, clientId) => conversaDoAgente(c, clientId)),
  agente_conversar: agenteConversar,
  agente_historico: agenteHistorico,
  executar_acao_agente: executarAcao,
  desfazer_acao_agente: desfazerAcao,
  // "Esquecer" e "Guardar como regra" do aprendizado (sem IA). As duas mesas (identidade e naming) têm a mesma rota:
  // guardar vai para a identidade; esquecer serve a qualquer regra do cliente.
  ...rotasDoAprendizado({ mesa: "identidade", servico, garantirAcesso: (ch, clientId) => garantirAcesso(ch as Chamador, clientId), json }),
};

/** Ações que podem passar de 150 s (IA, rede, PDF com imagens): a resposta começa na hora. */
const ACOES_LONGAS = new Set(["pesquisa_ia", "conceito_gerar", "conceito_imagem", "naming_gerar", "naming_conferir", "naming_pdf_compartilhar", "brandbook_compartilhar", "brandbook_publicar", "agente_conversar", "executar_acao_agente", "estrategia_propor", "paletas_propor", "fontes_propor", "slogans_gerar", "naming_idiomas"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "metodo_nao_permitido", mensagem: "Use POST." }, 405);
  try {
    const chamador = await identificar(req);
    let corpo: Record<string, unknown> = {};
    try {
      corpo = await req.json();
    } catch { /* corpo vazio */ }
    const acao = String(corpo.acao ?? "");
    const fn = ACOES[acao];
    if (!fn) return json({ error: "acao_desconhecida", mensagem: "Ação desconhecida.", aceitas: Object.keys(ACOES) }, 400);
    const rodar = async () => {
      try {
        return await fn(chamador, corpo);
      } catch (err) {
        return respostaDeErro(err);
      }
    };
    return ACOES_LONGAS.has(acao) ? respostaComFolego(rodar, corsHeaders) : await rodar();
  } catch (err) {
    return respostaDeErro(err);
  }
});
