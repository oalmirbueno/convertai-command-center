# Ligar os motores do painel

Frente MTR, 30/09/2026. Pedido do dono: "os motores do site e também do motion, edição de vídeo e também geração não estão funcionando".

Este guia diz o que cada motor precisa, como ligar os workers nesta máquina e onde ver se está tudo certo. O estado de cada motor fica no painel, em **Configurações › Estado dos motores** (ou `/config?motores=1`).

## 1. O que foi achado nos dados (30/09, 19:30 UTC)

| Motor | Causa exata | Corrigido no código? | Ação do dono |
|---|---|---|---|
| Motor do site (código) | O worker nunca foi ligado: `motor_executores` vazia. Um trabalho "construir" espera na fila desde 30/09 13:34 (horário de Brasília). O modelo escolhido era a OpenAI direta (`openai:gpt-6-luna`) e esta máquina só tem `OPENROUTER_API_KEY`: mesmo ligado, o worker morreria na subida do agente. | Sim: sem a chave direta, o worker segue pelo mesmo modelo no OpenRouter (com aviso na tela) e confere a chave antes de montar projeto e prévia. A pegada da fila agora solta o trabalho órfão (máquina caiu no meio: antes ficava "executando" para sempre, travando o projeto e a reserva da carteira) e cancela o que passou de 48 h na fila. | Guardar a `SUPABASE_SERVICE_ROLE_KEY` nesta máquina e ligar o worker (seção 3). Se ligar depois de 02/10 13:34, o trabalho de 30/09 é cancelado sozinho: peça de novo. |
| Render do Motion (cenas HyperFrames) | O worker de render nunca foi ligado: `render_workers` vazia. 5 stills da Rd Ar Climatização esperam na fila desde 30/09 13:10. O mesmo código, rodado aqui com esses 5 pedidos reais, fez os 5 stills (9:16) em 13 a 32 s cada. | Sim: batida a cada 30 s (antes a tela dizia "máquina desligada" no meio de um render longo) e as capacidades da máquina no Estado dos motores. | Ligar o worker de render (seção 3). Os pedidos com mais de 24 h na fila expiram quando ele ligar: peça de novo. |
| Render da Mesa Edição (Remotion) | Mesmo worker de render, nunca ligado. Nenhum pedido de render foi feito ainda (2 versões com projeto, 0 pedidos). O ponta a ponta local (onda, amostra de 9 s e vídeo inteiro de 12 s a -14 LUFS) passou nesta máquina. | Sim: o teste de ponta a ponta estava velho (contava a miniatura como MP4) e foi acertado. | Ligar o worker de render. |
| Geração de imagem (Estúdio e Mesa Foto) | Funciona (243 passos feitos; o último às 16:22 de 30/09). As falhas foram de dinheiro: OpenRouter 403 "Key limit exceeded" (limite da chave), 402 sem crédito em 29/09 e 6 pedidos com a carteira de IA do cliente sem saldo. Um timeout de 280 s na Mesa Foto. | Não precisava de código; o Estado dos motores mostra o crédito do OpenRouter e as carteiras quase vazias. | Manter crédito no OpenRouter e o limite da chave acima do uso; recarregar as carteiras dos clientes (Rodrigo com US$ 0,07 e Jobson com US$ 0,03 em 30/09). |
| Geração de vídeo (fal) | **Vídeo nunca foi pedido.** O único pedido da história (28/09) foi uma troca de ângulo de FOTO (`fal-ai/qwen-image-edit-2511-multiple-angles`), não um modelo de vídeo; nenhum Seedance, Kling, Veo, Wan ou MiniMax foi pedido. Nesse pedido, a tela foi fechada 38 s depois do envio e, quando reabriu, o código marcou "passou do prazo" SEM perguntar à fal: o resultado pronto (que a fal pode ter cobrado) se perdeu. A prova sem custo (esquema público de cada endpoint na fal + fetch falso) achou 11 de 56 caminhos de vídeo que a fal recusaria: Kling O3 (faltava `image_url`), MiniMax H3 (faltava `prompt_expansion_mode`; durações abaixo de 5 s) e LTX-2.3 Pro (12 e 14 s não existem). `FAL_KEY` está no servidor; Runway, Higgsfield e HeyGen não têm chave. | Sim: os 11 caminhos corrigidos (65 de 65 ok na prova, incluindo estender e ângulo); o pedido vencido segue conferido com aviso até 24 h e só então encerra, dizendo que o provedor pode ter cobrado; "Conferir de novo" (o botão Recuperar em Mesa Vídeos › Resultados › Gerações, frente VGN) reabre o que venceu e ainda tem o pedido na fal, inclusive o de 28/09. | Gerar um clipe curto de verdade (Seedance Lite ou Wan, 5 s) para provar o vídeo com custo; tocar em Recuperar ("Conferir de novo") no pedido de 28/09. Para Runway, Higgsfield ou HeyGen, pôr as chaves nos segredos do Supabase quando quiser usar. |
| Chaves e crédito da IA | `ANTHROPIC_API_KEY` e `ELEVENLABS_API_KEY` não existem nos segredos do Supabase (Claude vai pelo OpenRouter; a voz da ElevenLabs não roda pelas funções). Há três segredos com nome quebrado no Supabase ("#", "# (o campo aceita este formato NOME" e "Geral Aceleriq"), sobra de uma colagem. | O Estado dos motores lista o que falta. | Se quiser a Anthropic direta ou a voz ElevenLabs no servidor, pôr as chaves. Apagar os três segredos de nome quebrado (Supabase › Edge Functions › Secrets). |

Nenhum erro de código nas funções dos motores apareceu nos logs de 29 e 30/09: `mesa-motion`, `mesa-site`, `motor-codigo`, `editor-video` e `mesa-videos` responderam 200 (os 409 da `mesa-motion` foram "já há um pedido igual em andamento").

## 2. O que roda onde

| Motor | Onde roda | Precisa de |
|---|---|---|
| Motor do site | Máquina da agência: `workers/motor-codigo` (opencode + Vite + cloudflared) | Node 24, git, `SUPABASE_SERVICE_ROLE_KEY`, uma chave de modelo (`OPENROUTER_API_KEY` cobre todos). Opcionais: cloudflared (link público da prévia), Python 3.8+ (base de design), `VERCEL_TOKEN` (publicar). |
| Render do Motion e da Mesa Edição | Máquina da agência: `workers/render` (Remotion, HyperFrames, ffmpeg) | Node 24, ffmpeg, `SUPABASE_SERVICE_ROLE_KEY`. O Chrome do render o Remotion baixa sozinho na primeira vez. |
| Geração de imagem | Servidor (funções `estudio-arte`, `mesa-foto`) | `OPENROUTER_API_KEY` (e `OPENAI_API_KEY` para a OpenAI direta) nos segredos do Supabase, crédito no OpenRouter e saldo na carteira de IA do cliente. |
| Geração de vídeo | Servidor (função `mesa-videos`) + provedor (fal) | `FAL_KEY` nos segredos do Supabase. O andamento é conferido quando a Mesa Vídeos está aberta (Resultados, "Conferir"); o vencido segue conferível por até 24 h. |

Nada disso roda dentro de uma Edge Function: elas só põem o pedido na fila. Os workers puxam a fila com a chave de serviço, que fica só nesta máquina.

## 3. Ligar nesta máquina (Windows)

Os atalhos ficam em `workers\ligar\` (no clone do repositório nesta máquina):

| Atalho | O que faz |
|---|---|
| `guardar-chaves.cmd` | Pergunta as chaves sem mostrar e guarda nas variáveis do Windows (Usuário). Enter vazio mantém a que já existe. |
| `conferir-motores.cmd` | Confere Node, ffmpeg, git, cloudflared, Python, dependências e chaves. Não liga nada. |
| `ligar-render.cmd` | Instala as dependências na primeira vez (`npm ci`) e liga o worker de render nesta janela. |
| `ligar-motor-codigo.cmd` | Instala as dependências na primeira vez e liga o motor de código nesta janela. |
| `ligar-todos.cmd` | Abre uma janela para cada worker. |

Passo a passo, na primeira vez:

1. Pegue a chave de serviço do Supabase: painel do Supabase › Project Settings › API Keys › `service_role` (secret). Ela dá acesso total ao banco: não mande por mensagem nem cole em arquivo do repositório.
2. Dê dois cliques em `workers\ligar\guardar-chaves.cmd` e cole a chave quando pedir `SUPABASE_SERVICE_ROLE_KEY`. As outras (OpenRouter, OpenAI, Anthropic, Vercel) são opcionais aqui; a do OpenRouter já está nesta máquina.
3. Feche e abra o terminal (ou o Explorer) para as variáveis novas valerem.
4. Dê dois cliques em `conferir-motores.cmd`. Tudo que aparecer como FALTA precisa ser resolvido; aviso é opcional.
5. Dê dois cliques em `ligar-todos.cmd`. Deixe as duas janelas abertas.
6. No painel, abra Configurações › Estado dos motores e clique em Atualizar: em até 30 s os dois workers aparecem como Ligado.

No dia a dia basta o passo 5 (as dependências já estão instaladas e as chaves guardadas).

**Alternativa ao passo 2:** copie `workers\ligar\motores.env.exemplo` para `%USERPROFILE%\.aceleriq\motores.env` (fora do repositório) e preencha. O script lê esse arquivo só para a sessão e não sobrescreve o que já está nas variáveis do Windows.

**Para testar sem deixar ligado:** `ligar-motores.ps1 -Motor render -UmaVez` faz um pedido da fila e sai (o mesmo para `-Motor codigo`).

**Ligar sozinho quando o Windows entrar (opcional, o dono decide):** no Agendador de Tarefas, crie uma tarefa "Ao fazer logon" que rode `workers\ligar\ligar-todos.cmd`. Não fazemos isso por você.

### Observações da máquina

- O `npm ci` do npm 11 avisa que não rodou os scripts de instalação de alguns pacotes (`esbuild`, `onnxruntime-node`, `protobufjs`). O render funciona assim (provado no ponta a ponta desta máquina); não é preciso aprovar.
- O worker de render usa `%TEMP%\aceleriq-render` como pasta de trabalho; o motor de código usa `C:\AI\motor-codigo\projetos`.
- Depois de um `git pull` que mude o worker, feche a janela e ligue de novo.

## 4. Conferir se está funcionando

- **Painel:** Configurações › Estado dos motores. Para cada motor: situação (Ligado, Atenção, Parado, Sem uso), último sinal, fila, último erro legível e "O que fazer".
- **Mesas:** a Mesa Site, a Mesa Motion e a Mesa Edição já dizem "motor desligado" quando o pedido espera na fila.
- **Banco (só leitura):**

```sql
select nome, visto_em, versao, capacidades from public.render_workers order by visto_em desc;
select nome, visto_em, versao, capacidades from public.motor_executores order by visto_em desc;
select tipo, estado, count(*) from public.render_pedidos group by 1, 2;
select estado, count(*) from public.motor_trabalhos group by 1;
```

## 5. O que o código passou a fazer (frente MTR)

- `workers/render/batida.ts`: o worker de render bate ponto a cada 30 s (inclusive durante o render) e informa o que a máquina tem (ffmpeg, HyperFrames, GSAP, Chrome). Migration `20260930316000_estado_dos_motores.sql` amplia `render_workers` com `capacidades`, `pedido_id` e `iniciado_em`; sem ela, a batida grava só a linha mínima.
- A mesma migration troca a pegada do motor de código (`motor_pegar_trabalho`): trabalho "executando" há mais de 10 min sem a batida do worker com ele vira falhou (ou parado, se estava parando), e o que ficou mais de 48 h na fila vira cancelado; os dois com o evento "fim" para a tela fechar o trabalho.
- `workers/motor-codigo/lib/rota-do-modelo.ts`: sem a chave do provedor direto e com a do OpenRouter, o motor segue pelo mesmo modelo no OpenRouter; sem rota, falha logo no começo dizendo o nome da chave que falta.
- `supabase/functions/mesa-videos`: pedido de vídeo vencido pergunta ao provedor e, se ainda está na fila, gerando ou a consulta falhou (rede, 5xx), segue com aviso até o teto de 24 h (`desfechoDaConsulta`, `passouDoTeto`); só no teto vira erro, com "o provedor pode ter cobrado; confira" e o número do pedido. A ação `gerar_reconferir` ("Conferir de novo") reabre a variação que venceu e ainda tem o `request_id`; é a mesma ação do `gerar_recuperar` da frente VGN, e a coleta de 1 min (`gerar_coletar`) confere o vencido sem a tela aberta.
- `supabase/functions/mesa-videos/modulos/video-executor.ts` e `modelos-de-video.ts`: corpo do Kling O3 (`image_url`), MiniMax H3 (`prompt_expansion_mode`, 5 a 15 s), LTX-2.3 Pro (6, 8 ou 10 s) e Hailuo 2.3 Pro (sem duração) conferidos contra o esquema público da fal.
- Função nova `motores-estado` (só leitura, sem custo) e a seção Estado dos motores nas Configurações.
- `workers/ligar/`: os atalhos desta seção.
