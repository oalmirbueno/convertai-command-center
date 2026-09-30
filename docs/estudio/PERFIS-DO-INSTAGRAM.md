# Perfis do Instagram (frente P, 26/09/2026)

Pedido do dono: uma área de referências de perfil do Instagram por cliente (perfis que o estúdio e os agentes conhecem, para criar "naquele estilo"), um agente que prepara o estilo e propõe um plano editorial "igual a esse Instagram, só que com base no cliente", e concorrentes monitorados com inteligência automática.

Onde fica: Mesa, aba Contexto, grupo "Perfis do Instagram" (entre "Plano do cliente" e "Editar em detalhe").

## Estratégia

Um recurso só, **Perfis do Instagram**, com dois papéis por perfil:

- `referencia`: inspiração de estilo e de plano editorial.
- `concorrente`: monitoramento semanal (interruptor "Monitorar", desligado por padrão).

Limite por cliente: 6 referências e 6 concorrentes (arquivados não contam). Um @ tem um papel só por cliente. Apagar é arquivar.

### Captura (sem raspagem, sem senha de ninguém)

1. **API oficial**: Graph API `business_discovery` (`GET /{ig-user-id}?fields=business_discovery.username(<@>){...}`), só leitura de dados públicos.
   - Token: a conta Instagram profissional conectada do próprio cliente; sem ela, a da agência (perfil com `services_config.internal_company`, `@aceleriq` primeiro). Lido pela RPC `perfis_instagram_token`, que só a chave de serviço executa. O token nunca sai da função.
   - Se o primeiro token for recusado (vencido ou sem permissão), tenta o segundo uma vez (sem laço). Sem nenhum: "Conecte o Instagram da agência (ou o do cliente)" e o caminho manual segue aberto.
   - Primeira captura: até 24 posts. Depois (manual ou monitoramento): só os novos, até 12, parando no primeiro já conhecido. Os já conhecidos que voltam na resposta têm curtidas e comentários atualizados.
   - Imagem de cada post: a própria, a capa do vídeo ou a primeira do carrossel, baixada da CDN do Instagram e guardada no bucket `mesa` em `<cliente>/perfis/<perfil>/`. A foto do perfil também (a URL da CDN vence).
2. **Manual** (sempre disponível, o único para perfil pessoal): prints (grid, post ou carrossel; print com várias artes vale) e links de posts. Os prints sobem pela tela com as miniaturas próprias (`gravarCopiasSemEsperar`); link fica guardado para abrir.

Miniaturas: nunca transformação do Storage. A grade usa `urlsLevesEmLote` (miniatura `.mini.jpg` quando existe; imagem capturada pela API ganha a cópia leve na primeira vez que alguém da equipe vê). A leitura no servidor usa `reduzidaSemTransformacao` (o original do Instagram, até 1080 px, já cabe sem abrir).

### Leitura e inteligência

Números em código (`supabase/functions/perfis-instagram/modulos/perfis-instagram.ts`):

- engajamento = (curtidas + comentários) / seguidores;
- mediana por perfil (vale com 4 posts ou mais com número);
- fora da curva = engajamento >= 2x a mediana (a grade mostra "2,4x");
- frequência (posts por semana), mix de formatos (reel, carrossel, foto, vídeo) e horas e dias mais usados (horário de São Paulo).

Descrição visual: modelo de leitura do motor (papel `leitura` do catálogo, carteira do cliente), em lote de até 12 imagens, só para post sem leitura. Print com várias artes é descrito como prancha (quantas artes e o padrão comum).

Resumo do perfil (padrão visual, padrão editorial, o que funciona, o que evitar): gerado uma vez por captura (quando todos os posts foram lidos), não a cada abertura. "Refazer o resumo" no menu força.

### Perguntas do Jev (via `_shared/jev.ts`)

Leitura (um estado com o cliente e os posts; três perguntas por post, todas na mesma chamada):

| Pergunta | Tipo | Critério |
|---|---|---|
| `formato_<i>` | Choice | educativo_lista, bastidor, prova_social, oferta_promo, antes_e_depois, tendencia_meme, institucional, pergunta_enquete, nenhum |
| `pilar_<i>` | Choice | pilares do cliente (tirados das propostas do Mês) ou a lista padrão (educar, inspirar, provar, vender, conectar, entreter), sempre com "nenhum" |
| `combina_<i>` | Score (5 níveis) | quanto o post combina com o posicionamento e o público do cliente, para adaptar (nota de 0 a 10) |

Anti-cópia do plano e das ideias (um estado com o perfil de referência, o cliente e as pautas; duas perguntas por pauta, na mesma chamada):

| Pergunta | Tipo | Uso |
|---|---|---|
| `copia_<i>` | Noul, com critérios de sim e não | "A pauta copia o texto, a promessa ou a identidade do perfil em vez de adaptar ao cliente?" Probabilidade >= 0,4 tira a pauta do plano, com aviso. |
| `ritmo_<i>` | Noul | "A pauta mantém o formato e o ritmo do padrão do perfil?" Ordena as aprovadas. |

Sem laço de correção: o agente escreve 2 pautas a mais e o código escolhe as que passam. Se o Jev não responder, nenhuma pauta passa (a anti-cópia não é pulada). O custo do Jev entra na carteira do cliente (`cobrarJev`, tarefa verificacao).

## O que sai (tudo com confirmação)

Contrato comum (`_shared/acoes-do-agente.ts`, `CartaoDeAcao`), apelidos `p1..pN` para posts e `q1..qN` para pautas, nunca UUID.

1. **Levar ao estilo**: a equipe escolhe até 6 posts na grade (ou pede na conversa) e confirma; os posts vão como referências ao agente de estilo (`agente-estilo`, ação `conversar`, com o JWT de quem confirmou). Ele lê e propõe o estilo com a confirmação dele (botão "Estilo" no cabeçalho do agente do perfil abre o painel). A regra de ouro do S2 não muda: o interruptor desligado deixa o prompt do Estúdio byte a byte igual. Nada foi alterado no S2; é só um ponto de entrada.
2. **Plano igual**: mês (este ou o próximo) e quantidade (4 a 12). As pautas aprovadas pela anti-cópia viram uma lista "Pôr na agenda" com as datas espalhadas pelos dias úteis. Ao confirmar, a função abre uma proposta do Mês (`calendario_propostas`, status pronta, origem `perfis_instagram`) e chama o `gravar` do `agente-calendario`: mesma escrita do MCP, mesma idempotência, mesma direção de arte pronta no Estúdio. Desfazer usa `arquivar_item_agenda` do agente do Mês (com as travas dele: arte aprovada, agendada ou publicada não sai).
3. **Ideias de resposta** (concorrente, ou qualquer perfil): 1 a 3 pautas adaptadas ao cliente a partir dos posts fora da curva, com a mesma anti-cópia. Confirmar põe na agenda e o Estúdio já recebe o roteiro (a arte só sai quando a equipe gerar no Estúdio). As ideias ficam em `cliente_perfis_rodadas.ideias` e entram como sinal no Radar de ideias (`radar-ideas` lê as rodadas dos últimos 35 dias, com o JWT de quem chamou).
4. **Comparar com o cliente**: texto com os números do perfil e os do Instagram do cliente (`social_metrics_weekly`, `social_post_metrics`); quando falta número do cliente, o agente diz.

## Monitoramento dos concorrentes (sem laço)

- Interruptor "Monitorar" por concorrente, desligado por padrão. Ligar só marca a próxima janela do cron; nada dispara na hora.
- Cron semanal: segunda-feira, uma chamada por hora entre 9h17 e 14h17 UTC (6h17 a 11h17 em São Paulo). Cada chamada roda no máximo 4 perfis vencidos, com orçamento de 110 s.
- Trava: no começo da rodada `proxima_rodada_em` anda 7 dias (update condicional ao valor lido). Quem chegar junto não pega: resposta normal, nunca 40001. No máximo 1 rodada por perfil por semana.
- Erro: fica em `ultimo_erro` e na rodada; a próxima tentativa é na semana seguinte (sem nova tentativa imediata).
- Cada rodada: captura só o novo (até 12), recalcula os números, lê os novos, marca os fora da curva e gera de 1 a 3 ideias (texto, barato). A mensagem da rodada fica na conversa do perfil com a lista "Pôr na agenda" para a equipe confirmar.
- Teto de custo por rodada: US$ 0,30 (estimado antes de cada passo pago; passou, para e registra `teto`).
- Aviso: só quando há post fora da curva, um por cliente por rodada, para admins e gestores (link para a aba Contexto).

### Como ligar

1. Aplicar o SQL (`P-01-perfis-instagram.sql`, tabelas, RLS, RPC do token).
2. Publicar a função `perfis-instagram` (e `radar-ideas`, que ganhou a leitura dos sinais).
3. Conferir a conexão do Instagram da agência (Integrações, `@aceleriq`) e se o app da Meta tem acesso ao `business_discovery` (permissões `instagram_basic` e `pages_read_engagement`, e acesso avançado em produção).
4. Quando o dono mandar, rodar o bloco comentado no fim do SQL (cron `perfis-instagram-semanal`). Para desligar: `select cron.unschedule(jobid) from cron.job where jobname = 'perfis-instagram-semanal';`.

## Limites da API

- Só perfil Business ou Creator público. Perfil pessoal ou privado volta "use prints e links".
- Dados públicos: legenda, tipo, data, link, curtidas e comentários (a Meta pode esconder curtidas quando o dono do perfil esconde). Sem alcance, salvamentos, compartilhamentos nem stories de terceiros.
- Quantidade: o painel pede no máximo 24 posts na primeira vez e 12 depois. A Graph API tem limite de chamadas por hora por conta; a função trata o limite como "tente mais tarde", sem repetir.
- URLs de mídia da CDN vencem: por isso a imagem é copiada para o Storage do cliente.

## Custos estimados (dependem dos modelos padrão do catálogo)

| Passo | O que roda | Ordem de grandeza |
|---|---|---|
| Capturar | Graph API e Storage | sem custo de IA |
| Ler 12 posts | 1 chamada do leitor com 12 imagens + 1 do Jev | cerca de US$ 0,01 a 0,03 |
| Resumo | 1 chamada de texto curta | cerca de US$ 0,005 a 0,02 |
| Plano igual (8 pautas) | 1 chamada de texto (10 pautas) + 1 do Jev | cerca de US$ 0,02 a 0,10 |
| Ideias de resposta | 1 chamada de texto (4 pautas) + 1 do Jev | cerca de US$ 0,01 a 0,04 |
| Rodada semanal por concorrente | captura + leitura dos novos + ideias | cerca de US$ 0,02 a 0,07, teto de US$ 0,30 |

O Jev custa US$ 0,042 por milhão de tokens de entrada (fração de centavo por chamada). Tudo entra na carteira do cliente e em `cliente_perfis_rodadas` (auditoria e custo).

## Arquivos

- Tela: `src/components/perfis/` (`PerfisDoInstagram.tsx`, `PerfilAberto.tsx`, `AgenteDoPerfil.tsx`, `perfisApi.ts`) e um grupo a mais em `src/components/mesa/AbaContexto.tsx`.
- Função: `supabase/functions/perfis-instagram/index.ts` (registrada em `supabase/config.toml`; motor `perfis.plano` em `_shared/motores.ts`).
- Regras puras: `supabase/functions/perfis-instagram/modulos/perfis-instagram.ts`.
- SQL (não aplicado): `P-01-perfis-instagram.sql` no scratchpad da sessão.
- Testes: `src/test/perfis-instagram.test.tsx`.

## O que ficou de fora

- Busca de perfis parecidos por nicho (opcional no pedido): fica para depois, pela pesquisa web do motor, sempre como sugestão que a equipe confirma.
- Recorte automático das artes de um print com várias artes: o print é lido como prancha; quando vai ao estilo, a leitura de prancha do Estúdio continua valendo.
