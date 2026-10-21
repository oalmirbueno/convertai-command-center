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
 * - projeto_excluir { projeto_id } -> { excluido: true, projeto_id } (apaga as execuções e o projeto; os arquivos ficam em Arquivos) | 409 projeto_em_uso (nó rodando ou Pôr no ar com pedido aberto)
 * Templates:
 * - templates_listar {} -> { templates } ; template_usar { template_id, nome?, client_id?, contexto? } -> { projeto }
 * - template_salvar { nome, projeto_id | canvas, descricao?, icone? } -> { template } (pessoal, oficial = false)
 * Custo e execução:
 * - estimar { projeto_id, nos? } -> { por_no: [{ no_id, tipo, custo_usd, chamadas }], total_usd, ordem, carteira_client_id, livre }
 *   ou { alvo: "logo", n?, motor?, qualidade?, client_id? } / { alvo: "planejar", modelo_id?, mensagem? }
 * - no_executar { projeto_id, no_id, confirmado } -> { execucao_id, execucao, saida? } (carrossel/landing: 202 e segue)
 * - estimar { projeto_id, nos?, rodada?: true }: com rodada, inclui ancestrais necessários e reutiliza entradas prontas.
 * - rodada_cancelar { projeto_id, rodada_id } -> { canceladas: no_id[] }; só etapas aguardando dependências, nunca trabalho já iniciado.
 * - conexoes_da_casa { projeto_id, no_id, catalogo?: true } -> { produtos } ou { contexto }; somente leituras autorizadas de CRM/biblioteca.
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
 * Créditos do Laboratório (20/10, migration 20261020050000; creditos.ts): carteira só do Laboratório.
 * - creditos {} -> { saldo_usd, ativa, pode_carregar, movimentos (50), gasto_mes_usd, por_projeto, disponivel }
 * - creditos_carregar { valor_usd (1 a 10.000), nota? } (só admin; registro manual) -> { saldo_usd, ativa }
 * - creditos_limite { ativa } (só admin) -> { saldo_usd, ativa }
 * - no_executar / rodar_tudo / filme_escolher com confirmado reservam o custo estimado; carteira ativa sem
 *   saldo -> 402 sem_credito { saldo_usd, custo_usd }. Inativa (o começo) só registra. Falha devolve (estorno).
 * Nós inteligentes (20/10; inteligencia.ts e modulos/inteligencia.ts; migration 20261020080000):
 * - fontes_do_cliente { client_id: uuid | null } -> { cliente: { id, nome, nicho } | null, dossie: { resumo (≤1500), pontos } | null,
 *   marca: { cores, fontes, tom, logo_url, nunca } | null, midias: [{ id, tipo: imagem|video, url, miniatura_url, nome, origem }] (≤60),
 *   documentos: [{ id, nome, tipo, url }] (≤40) }. Equipe com can_access_client; nulo = marca da Aceleriq (cliente interno)
 *   e mídias do Workspace global do Laboratório. Não gasta IA. (miniatura_url pode vir null em vídeo sem miniatura.)
 * - no_preencher { projeto_id, no_id, pedido? (≤1000), campos?, confirmado? } -> { dados (só CAMPOS_DO_TIPO, por dadosDoTipo),
 *   explicacao (≤300), custo_usd, campos, modelo_id }. Sem confirmado: 409 confirmacao_necessaria { total_usd, por_no }.
 *   Usa as entradas ligadas, o dossiê e a marca, os documentos do nó e o pedido; número sem fonte vira [PREENCHER: número].
 *   Não preenche anexo, link, gateway, domínio, data nem o que multiplica o custo. Não salva o canvas. Reserva nos créditos.
 * - ler_documento { projeto_id, arquivo: { id, path?, url?, nome? }, resumir?, confirmado? } -> { texto (≤16000), resumo (≤600), lido }
 *   (PDF com texto embutido e .docx pelo leitor sem biblioteca; ler não gasta; resumir pede confirmação do custo).
 * - projeto_config { projeto_id, config? } -> { config: { auto_ate_usd } } (sem config só lê). projeto_ler devolve projeto.config;
 *   projeto_salvar também aceita config { auto_ate_usd: 0 a 5 } (acima de 0: só admin
 *   ou gestor). no_executar { automatico: true }: nó com dados.auto e custo ≤ auto_ate_usd roda sem o 409 (crédito conferido na
 *   reserva: 402 sem_credito); fora disso, 409 com motivo_do_automatico.
 * - Nó Mídia aceita dados.midias: [{ id, tipo: imagem|video (mp4, mov, webm), url, path, nome }] (até 8); vídeo segue como entrada.
 * Motor da casa (20/10; motor-da-casa.ts, ajustes.ts, modulos/motor.ts):
 * - Resultado e Carrossel geram pela Arte rápida da estudio-arte (origem 'laboratorio', com o JWT de quem rodou):
 *   rapida_preparar + enfileirar; o nó fica 'aguardando' (saida.motor 'estudio_arte', etapa 'gerando') e o
 *   no_acompanhar termina: com as lâminas prontas, copia para Laboratório/<Livres | cliente>/<projeto> e fica 'pronto'.
 *   Logo segue pelo logo_gerar (Mesa Identidade). Template, personagem e quadros do UGC: motor de imagem direto.
 *   saida.usou: [{ tipo, rotulo, no_id, como? }] = o que entrou de fato (copy = texto exato, marca, mídia = foto real...).
 * - salvar_nos_arquivos { projeto_id, no_id, indices?, destino: 'cliente' | 'laboratorio' } -> { salvos: [{ nome, path, pasta }] }
 *   ('cliente': Workspace do cliente, pasta Laboratório / <projeto>, can_access_client; sem cliente: 400 sem_cliente).
 * - no_ajustar { projeto_id, no_id, indice, pedido (≤500), confirmado? } e no_variar { projeto_id, no_id, indice,
 *   quantidade 1..4, confirmado? } -> 202 { execucao_id, status: 'rodando' } (nova execução do nó; sem confirmado: 409
 *   confirmacao_necessaria com o custo; reserva nos créditos, falha devolve).
 * - planejar devolve nos_soltos: [{ no_id, tipo, motivo }] (regra das cadeias que fecham).
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
