# Mesa do cliente, versão 4: agente do mês, hypes e campanhas (23/09/2026)

Pedido do dono: um agente dentro do Mês para pedidos livres (com imagens e prints), um botão para buscar os hypes da semana pelo contexto de cada cliente, e uma área de campanhas (tema, identidade do tema com selo, conteúdos) que atualiza o calendário e chega ao Estúdio já na identidade da campanha. Tudo com poucos cliques, na mesma tela.

Chamadas pela `chamarFuncao("agente-calendario", { acao, ... })` de `src/lib/mesa/api.ts`. Toda ação que gasta passa pelo `BotaoComCusto` (preço ao lado, executa no clique).

## Anexos (imagens e prints)

A tela sobe cada imagem no bucket `mesa` em `<client_id>/pedidos/<uuid>.<ext>` (upload direto pelo Storage do navegador; a equipe já grava no bucket mesa, veja como ReferenciasDoEstudio ou SeletorDoAcervo sobem arquivos). Os caminhos vão em `anexos: string[]` (até 6). O servidor só aceita caminho que começa com o `client_id`.

## Ações

- `pedido_livre { client_id, mensagem, anexos?: string[], data_inicio?: 'AAAA-MM-DD', campanha_id?: string }` → `{ proposta, resposta, conversa_id, project_id, custo_usd }`. A proposta vem com `status: 'pronta'` e `itens[]` (tema, data, formato, gancho, copy, cards[] com texto, ilustração). A conversa do agente do mês é uma só por cliente (`agente_conversas` com `referencia_tipo = 'agente_do_mes'`; mensagens em `agente_mensagens`, a do agente tem `anexos: [{ proposta_id }]`), a tela lê direto (RLS da equipe) para mostrar o histórico.
  - Gravar na agenda: `gravar { proposta_id, project_id }` (use o `project_id` devolvido; sem ele, peça para escolher o projeto de social). Depois de gravar, os itens aparecem no Mês e no Estúdio já dirigidos.
  - Ajustar antes de gravar: `conversar { proposta_id, mensagem }` (já existia).
- `buscar_hypes { client_id, forcar?: boolean }` → `{ hypes: { semana, resumo, itens: [{ titulo, o_que_e, por_que_agora, fonte, janela: 'hoje'|'esta_semana'|'proximas_semanas', como_usar, formato, cuidado, nota: 0..10 }] }, cache: boolean, custo_usd }`. Uma busca por cliente e semana: sem `forcar`, repete a da semana sem custo (a tela pode ler direto `mesa_hypes` do cliente e mostrar a data da busca; "Buscar de novo" usa `forcar: true`). Cada hype tem duas ações: "Criar conteúdo" (chama `pedido_livre` com a mensagem montada do hype: título, como usar, formato, janela) e "Criar campanha" (chama `campanha_criar` com `hype`).
- `campanha_criar { client_id, pedido, periodo_inicio?, periodo_fim? (até 62 dias), quantidade? (1 a 12), anexos?, referencias_ids? (ids de cliente_referencias ou 'g:<id>' do banco global), hype? }` → `{ campanha, proposta, resposta, project_id, custo_usd }`. `campanha.identidade = { tema_visual, paleta_apoio: [{nome, hex}], tipografia, elementos, tom, selo: { texto, descricao } }`.
- `campanha_ajustar { campanha_id, mensagem }` → `{ campanha, resposta, custo_usd }` (nome, objetivo, conceito, identidade). Os conteúdos se ajustam com `conversar` na `campanha.proposta_id`.
- `campanha_selo { campanha_id }` → `{ campanha, selo_path, custo_usd }`: desenha o selo (logo do tema) no bucket mesa; mostre com `useUrlDaMesa(selo_path)` e deixe gerar de novo.

## Banco (leitura direta, RLS da equipe)

- `mesa_campanhas`: `id, client_id, nome, pedido, objetivo, periodo_inicio, periodo_fim, conceito, identidade, referencias_ids, selo_path, proposta_id, status ('planejada'|'gravada'|'encerrada'), custo_usd, criado_em, atualizado_em`. A equipe pode dar update em `nome, status, referencias_ids`.
- `mesa_hypes`: `client_id, semana, itens, resumo, custo_usd, criado_em`.
- `calendario_propostas.parametros.campanha_id` e `itens[].campanha_id` ligam os conteúdos à campanha; `estudio_trabalhos.direcao.campanha_id` idem no Estúdio (para agrupar "Conteúdos da campanha X" na lista do Estúdio e mostrar o selo).

## Referências da campanha

A área de campanha reaproveita a galeria de referências do Estúdio (cliente + banco global da agência com busca, 1.386 pins do Pinterest do dono) para escolher `referencias_ids` da campanha (update direto em `mesa_campanhas.referencias_ids`). Os conteúdos da campanha herdam essas referências no Estúdio.
