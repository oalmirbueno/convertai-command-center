// One version for the server and its OAuth metadata.
// 2.17.0 (22/10/2026): painel inteiro (panoramas, Mês, Estúdio, Site, Laboratório, base, membros, guia), prazo, nova tentativa, cache curto, lista enxuta.
// 2.18.0 (25/10/2026): comercial com o Mercurio (fila, conversa, Caixa, fatos com prova, agente no lead) e Maquina de leads.
// 2.19.0 (26/10/2026): autoria por credencial, diario com limite e reply_to, rodada sem fato nao gira a fila, done so com prova, create_task sem duplicar (origem_externa), aceleriq_ads_registrar_acao e aceleriq_ads_boletim.
// 2.20.0 (26/10/2026): aceleriq_navegador_do_pc, o Ego Lite do PC do dono com os logins dele (Meta, Instagram, Google), pelo worker do navegador; PC desligado = indisponivel sem repetir.
// 2.21.0 (26/10/2026): horario comercial do Ego (9h-18h seg a sex, Sao Paulo; EGO_HORARIO/EGO_DIAS/EGO_FUSO): fora da janela aceleriq_navegador_do_pc agenda (estado agendada, executar_a_partir_de, prioridade) e responde agendado_para com nao_insistir; guia com trabalho de nuvem fora do horario e regra de nada parado.
// 2.22.0 (27/10/2026): lembrete de aprovacao e regua de cobranca: aceleriq_mensagens_automaticas_fila (so o que o dono aprovou, so na janela 9h-18h dia util) e aceleriq_mensagens_automaticas_marcar_enviado.
// 2.22.0 (27/10/2026, mesma versao): torneira das tarefas (aceleriq_create_task de agente so com cliente, dono e prazo) e aceleriq_ads_boletim aceita nivel medio/baixo/alto (vira atencao/info/critico).
export const MCP_VERSION = '2.22.0';
