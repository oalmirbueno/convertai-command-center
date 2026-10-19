/**
 * laboratorio: o Laboratório da Aceleriq (/laboratorio), 19/10/2026.
 * Contrato: Aceleriq-Laboratorio/ESPEC-LABORATORIO.md.
 *
 * POST { acao, ... }; só admin, manager e design (JWT lido aqui; verify_jwt também ligado).
 * Erro sai como { error, mensagem } (nas ações com fôlego o status real vai em status_http).
 * Custo: estimar antes; gerar só com confirmado: true (senão 409 confirmacao_necessaria com o custo).
 * Carteira: o cliente do projeto ou, sem cliente ("Livre"), o cliente interno da Aceleriq; tarefa 'laboratorio'.
 * Saídas: bucket workspace (global/laboratorio/<projeto>/…) + workspace_nodes global em
 * Laboratório/<Livres | Nome do cliente>/<projeto>. Resultado com cliente NÃO entra na Mesa do cliente.
 *
 * Projetos:
 * - projetos_listar { client_id?, livres?, arquivados?, busca? } -> { projetos: [{ id, nome, client_id, cliente_nome, status, versao, nos, ... }] }
 * - projeto_criar { nome, client_id?, contexto?, canvas? } -> { projeto }
 * - projeto_ler { projeto_id } -> { projeto, cliente_nome, execucoes: { [no_id]: última execução } }
 * - projeto_salvar { projeto_id, versao_esperada, nome?, contexto?, canvas?, client_id? } -> { projeto } | 409 versao_mudou { projeto_atual }
 * - projeto_arquivar { projeto_id, arquivar? = true } -> { projeto }
 * Templates:
 * - templates_listar {} -> { templates } ; template_usar { template_id, nome?, client_id?, contexto? } -> { projeto }
 * - template_salvar { nome, projeto_id | canvas, descricao?, icone? } -> { template } (pessoal, oficial = false)
 * Custo e execução:
 * - estimar { projeto_id, nos? } -> { por_no: [{ no_id, tipo, custo_usd, chamadas }], total_usd, ordem, carteira_client_id, livre }
 *   ou { alvo: "logo", n?, motor?, qualidade?, client_id? } / { alvo: "planejar", modelo_id?, mensagem? }
 * - no_executar { projeto_id, no_id, confirmado } -> { execucao_id, execucao, saida? } (carrossel/landing: 202 e segue)
 * - rodar_tudo { projeto_id, confirmado, nos? } -> 202 { rodada_id, ordem, execucoes: { [no_id]: execucao_id } } (segue com waitUntil)
 * - execucoes_ler { projeto_id, rodada_id?, no_id?, limite? } -> { execucoes }
 * Agente do projeto (nunca gera nem publica):
 * - planejar { projeto_id, mensagem, modelo_id?, historico? } -> { resposta, operacoes: [{ indice, op, aceita, recibo, operacao }], canvas_previsto, versao, custo_usd }
 * - pedido_inicio { pedido, client_id?, modelo_id?, nome? } -> 201 { projeto, resposta, operacoes }
 * Logo (também da Mesa Identidade):
 * - logo_gerar { nome, client_id?, conceito?, paleta?, estilo?, n? = 4, motor?, qualidade?, projeto_id?, referencias? (global/laboratorio/…), confirmado }
 *   -> { execucao_id, projeto_id, imagens, escolha: { indice, caminho, motivo, confianca }, aviso_jev, custo_usd }
 *
 * v2 (Aceleriq-Laboratorio/ESPEC-LABORATORIO-v2.md): nós pesquisa, oferta, funil, filme e por_no_ar.
 * - planejar / pedido_inicio aceitam modo: "projeto_completo" (ou detectam pelo pedido): até 40 nós já ligados, em
 *   colunas por etapa (Pesquisa → Oferta → Conteúdo → Página → Criativos → Anúncios → Pôr no ar); devolvem modo e colunas.
 * - filme_escolher { projeto_id, no_id, indice } -> { execucao_id, execucao } (storyboard escolhido, cenas na fila de render)
 * - no_acompanhar { projeto_id, no_id } -> { execucao_id, execucao } (Filme: render e montagem; Pôr no ar: estado do pedido)
 * v3 (clickmax-rea.md):
 * - perguntas_do_pedido { pedido, client_id? } -> { perguntas: [{ id, pergunta, exemplos }], fonte, custo_usd } (Jev, até 4)
 * - planejar / pedido_inicio: projeto completo sem o essencial -> { perguntas, operacoes: [] }; mande respostas ou pular_perguntas
 * - bloco_resolver { projeto_id, no_id, bloco_id, modo: "fonte" | "editar", fonte? | texto? } -> { execucao_id, execucao }
 *   (bloco rascunho_sem_fonte; enquanto houver algum antes do Pôr no ar, ele responde 409 rascunho_sem_fonte)
 * Filme: mesa-motion (filme_criar, filme_salvar, storyboards_gerar, storyboard_escolher, cena_pedir, filme_ler, montar,
 * render_status) com a sessão de quem pediu. Pôr no ar: só cria o pedido em operator_approvals; aprovado, o gatilho
 * da migration 20261019233000 entrega a tarefa ao operador (operator_assign_task). Nada vai ao ar sem o dono.
 */
import { respostaComFolego } from "../_shared/resposta-com-folego.ts";
import { corsHeaders, identificar, json, respostaDeErro } from "./comum.ts";
import { ACOES, ACOES_LONGAS } from "./acoes.ts";

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
