# Mesa Ads: criativos de anúncio para alta conversão

Pedido do dono (23/09/2026): uma área só para criativos de anúncio (tráfego pago), na mesma estrutura da Mesa do cliente, focada em campanhas dos clientes e em resultado. Base de conhecimento: o dossiê "Referências que viram criativos" (pasta Pesquisa-Criativos-2026-09-23: DOSSIE-CRIATIVOS.md, CONTEXTO-PARA-AGENTES.md, FICHA-DE-REFERENCIA.md, catalogo-referencias.json com 39 fontes) mais o que já sabemos de resposta direta, formatos e políticas da Meta.

## Princípios (valem para todo agente e tela)

- Começa na situação vivida pelo comprador, não na categoria. Mapa do clichê da categoria e um contraste relevante.
- Ângulo antes de execução: testar hipóteses realmente diferentes; só depois variar gancho, prova e formato.
- Nunca inventar depoimento, número, resultado, urgência, escassez ou disponibilidade. Prova só a que o cliente tem.
- Escala de evidência de toda referência e de todo criativo: E0 referência, E1 circulação observada, E2 sinal indireto (longevidade, variações), E3 resultado documentado (gasto, resultado, período, atribuição), E4 replicação própria (teste na nossa conta confirmado em nova janela). Longevidade, curtidas e "biblioteca de vencedores" não são prova de retorno.
- Métrica que decide é a do negócio (lead qualificado, reunião, venda), não só clique.
- Política de anúncios da Meta respeitada: sem atributos pessoais ("você é diabético?"), sem alegação de saúde, renda ou resultado não comprovado, sem antes e depois proibido, sem linguagem sensacionalista ou discriminatória, sem camuflar produto nem contornar análise.

## Onde fica

Rota `/mesa-ads` ("Mesa Ads"), mesma casca da Mesa: barra fina com seletor de cliente, saldo e etapas. Staff (admin, manager, design). Etapas:

1. **Oferta**: o briefing de performance do cliente.
2. **Referências**: biblioteca de anúncios e fichas.
3. **Plano de teste**: ângulos e hipóteses com o estrategista de ads.
4. **Estúdio Ads**: produção dos criativos (imagem e copy do anúncio) com o motor do Estúdio.
5. **Resultados**: métricas reais dos anúncios, diagnóstico e aprendizado.

## Banco (migrations aplicadas pelo coordenador)

- `ads_briefings` (1 atual por cliente, versões): `id, client_id, versao, atual, oferta jsonb {produto, promessa, condicao, preco_confirmado, garantia}, publico jsonb {quem, situacoes[{texto, fonte}], estagio_consciencia ('inconsciente'|'problema'|'solucao'|'produto'|'mais_consciente'), motivacoes[]}, objecoes jsonb [{texto, resposta, fonte}], provas jsonb [{tipo ('depoimento'|'numero'|'caso'|'certificacao'|'demonstracao'), texto, fonte, autorizado bool, periodo}], destino jsonb {tipo ('whatsapp'|'pagina'|'formulario'|'direct'|'ligacao'), url, primeira_mensagem}, objetivo jsonb {acao ('mensagens'|'leads'|'vendas'|'trafego'|'agendamento'), metrica_principal, custo_toleravel_brl, verba_diaria_brl}, restricoes text, criado_por, criado_em`.
- `ads_referencias`: `id, client_id (null = biblioteca da agência), titulo, url, origem ('meta_ad_library'|'tiktok'|'swiped'|'pinterest'|'instagram'|'upload'|'anuncio_proprio'|'outro'), storage_path, ad_id (anúncio próprio em ads_creatives), plataforma, formato, evidencia ('E0'..'E4'), metricas jsonb, ficha jsonb (campos da FICHA-DE-REFERENCIA: situacao, motivacao, estagio, gancho_visual, gancho_verbal, argumento, prova, objecao, cta, destino, mecanismo, o_que_transportar, o_que_substituir, limites), mecanismo text, tags text[], destaque bool, ativa bool, criado_em`.
- `ads_planos`: `id, client_id, briefing_id, status ('rascunho'|'aprovado'|'em_teste'|'concluido'), angulos jsonb [{id, nome, situacao, mecanismo, referencia_ids[], prova, gancho_visual, gancho_verbal, hipotese, metrica, janela_dias, formatos[], variacoes (1 a 3), jev {clareza, relevancia, prova, risco_politica}}], estrutura jsonb (conjuntos, verba sugerida), conversa_id, custo_usd, criado_por, criado_em, atualizado_em`.
- `ads_criativos`: um por variação produzida: `id, client_id, plano_id, angulo_id, trabalho_id (estudio_trabalhos), formato ('feed_4x5'|'quadrado_1x1'|'stories_9x16'|'carrossel'), copy jsonb {texto_principal, texto_principal_longo, titulo, descricao, cta_meta}, roteiro_video jsonb|null, status ('rascunho'|'pronto'|'no_ar'|'pausado'|'encerrado'), ad_id (vínculo com ads_creatives quando sobe para a Meta), evidencia, criado_em, atualizado_em`.
- `ads_aprendizados`: `id, client_id, criativo_id, plano_id, periodo_inicio, periodo_fim, metricas jsonb, diagnostico jsonb, texto (registro no formato do dossiê), evidencia ('E3'|'E4'), criado_por, criado_em`.
- `estudio_trabalhos` ganha `tipo text default 'social'` ('social'|'ads'). Card da direção ganha `formato` ('feed_4x5'|'quadrado_1x1'|'stories_9x16'); lâmina de ads usa o tamanho do formato.
- `ia_usos.tarefa` aceita 'ads'; `ia_usos.agente` e `agente_conversas.agente` aceitam 'estrategista_ads'.
- RLS: equipe (is_staff + can_access_client) lê tudo do cliente e escreve briefing, referências, status e vínculos; biblioteca da agência (client_id null) só leitura para a equipe.

## Função `mesa-ads` (Deno, POST { acao, ... }, só equipe com acesso ao cliente)

- `briefing_sugerir { client_id }`: lê kit, contexto consolidado, dossiê, métricas de ads do cliente (ads_creatives + ads_creative_daily) e propõe o briefing, marcando o que é dado real e o que é lacuna. Não grava sozinho: devolve `{ sugestao, lacunas[] }`.
- `briefing_salvar { client_id, briefing }`: nova versão atual.
- `referencia_ler { client_id, referencia_id }`: leitor de IA preenche a ficha a partir da imagem ou print (sem inventar métrica; evidência padrão E0).
- `referencias_importar_proprias { client_id }`: traz os anúncios do cliente de ads_creatives com métricas somadas de ads_creative_daily; evidência E3 quando houver gasto e resultado; grátis.
- `plano_gerar { client_id, briefing_id?, pedido?, quantidade_angulos? (3 a 6) }`: estrategista de ads gera ângulos distintos (situação × mecanismo × prova) com hipótese no formato do dossiê ("Acreditamos que [situação + mecanismo] aumentará [resultado], porque [evidência]. Vamos comparar com [base] durante [janela]..."), usando referências em destaque; o Jev pontua clareza, relevância, força da prova e risco de política.
- `plano_conversar { plano_id, mensagem, anexos? }`: ajusta o plano pela conversa (microfone na tela).
- `criativos_produzir { plano_id, angulo_ids[], formatos[] }`: para cada ângulo e formato cria o `ads_criativo` com a copy (Jev confere política e clareza) e um `estudio_trabalhos` tipo 'ads' já dirigido (direção montada pelo diretor com o conhecimento de ads), pronto para gerar no Estúdio Ads.
- `copy_variar { criativo_id, pedido? }`: variações de texto principal, título e CTA.
- `resultados_ler { client_id, periodo? }`: métricas por criativo vinculado (gasto, impressões, CTR de saída, CPC, CPM, frequência, resultados e custo por resultado), diagnóstico pela tabela do dossiê.
- `aprendizado_registrar { criativo_id, periodo_inicio, periodo_fim, texto? }`: grava aprendizado (E3; E4 quando confirmar em nova janela) e alimenta a memória do estrategista de ads.

## Estúdio Ads (estudio-arte)

- Trabalho `tipo = 'ads'`: cada card é um criativo com `formato`; tamanhos 1088x1360 (feed 4:5), 1088x1088 (1:1), 1088x1920 (9:16, stories e reels, zona segura: nada importante nos 14% de cima e nos 20% de baixo).
- Prompt de ads (conhecimento-ads.ts): uma mensagem por peça, benefício específico, prova visível quando existir, CTA claro, contraste que para a rolagem, leitura em 1 segundo no celular, marca presente sem dominar, texto curto na imagem.
- Conferência de ads: além de texto, identidade e logo, o Jev confere risco de política e clareza da oferta.

## Base de conhecimento (_shared/conhecimento-ads.ts)

Dossiê inteiro em regras operacionais (18 técnicas, 7 etapas da referência à peça, escala E0 a E4, diagnóstico por sinal, medição consistente) e o complemento: níveis de consciência (Schwartz), estruturas de copy (PAS, AIDA, BAB, 4U), tipos de gancho, anatomia do estático de alta conversão, especificações e zonas seguras da Meta, limites de texto do anúncio (texto principal visível em cerca de 125 caracteres, título até 40), CTAs da Meta, políticas resumidas, fadiga criativa (frequência), estrutura de teste (ângulo, depois execução; uma variável por vez).
