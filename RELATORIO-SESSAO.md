# Relatório: queda de sessão do painel (14/11/2026)

PR: https://github.com/oalmirbueno/convertai-command-center/pull/134 (draft, contra `main`, sem merge)
Branch: `infra/sessao-painel-duradoura`
Commits: `267e766` (código e testes), `d7204a5` (este relatório) e o ajuste da revisão do Codex (seção abaixo)

## Resultado

A sessão do painel caía por três defeitos do front, que juntos faziam o navegador ficar com um refresh token já trocado. A correção está no PR, com testes. Ela reproduz o incidente no código antigo e passa no novo. Não entra no ar até o merge e o Publish, que são etapas manuais.

## (1) Tentativas de senha: análise da Orion confirmada

Fatos dos logs (projeto `jjjtkowvxemvituvywvf`, janela de 13/11 21:00Z a 14/11 20:53Z):

- Houve 5 tentativas com senha errada, todas de `aceleriq@gmail.com`, do IP `104.28.207.234`, entre 20:23:42Z e 20:25:08Z (17:23 a 17:25 em São Paulo). Todas foram `invalid_credentials`, sem 429 e sem bloqueio.
- O login deu certo no mesmo IP às 20:27:58Z (17:27).
- Nenhum outro IP tentou senha. Não foi ataque externo: foi a Orion tentando entrar depois que a sessão caiu.

**Achado à parte (não corrigido aqui):** às 19:19:37Z, 19:21:16Z e 19:23:14Z houve 3 `user_recovery_requested` e 3 logins da mesma conta com user-agent `Deno/2.1.4 SupabaseEdgeRuntime`, no mesmo intervalo em que a função `mcp-server` estava ativa. Isso deixou 3 sessões órfãs da Edge Runtime, que ainda existem, e provavelmente mandou e-mails de recuperação para a conta. Precisa de um lote próprio para descobrir qual ferramenta do MCP faz recover/login com a conta da casa.

## (2) Causa da queda

A conta tem 9 sessões ao mesmo tempo, `not_after` nulo e rotação de refresh token ligada. Cada renovação troca o token. Se o mesmo token for usado duas vezes fora da janela de reuso, ou se o cliente perder a resposta, a segunda renovação recebe `refresh_token_not_found`. Nesse caso o supabase-js **apaga a sessão guardada** (`_removeSession`), e isso vale até para a sessão nova que outra aba acabou de gravar.

Os três defeitos do front:

| | Onde | Defeito | Evidência |
|---|---|---|---|
| A | `src/contexts/AuthContext.tsx` (abertura) | `refreshSession()` forçado em toda abertura, mesmo com o token valendo | 4 renovações no mesmo Chrome/IP em menos de 1 min (20:13:45Z a 20:14:43Z); a sessão `0f257b32` parou de renovar e a Orion caiu no login às 20:23Z |
| B | `src/integrations/supabase/travaDoLogin.ts` | quando a espera da trava estourava, a operação rodava **sem a trava**, inclusive a renovação | o teste novo reproduz: `ok:t0->t1` seguido de `morto:t0` |
| C | `src/integrations/supabase/fetchComPrazo.ts` | o prazo de 10 s também **abortava a renovação**, mesmo depois de o servidor já ter trocado o token | 19:53:58Z: `POST /token` 500 "error finding refresh token: context canceled", seguido de vários `token_revoked` |

Além disso, nos dois caminhos de erro o AuthContext chamava `signOut()` sem scope, que no supabase-js vale como `global`.

### Rajada em `/oauth/token`: não vem do painel

- Fato: o supabase-js 2.97 do painel só renova por `/auth/v1/token?grant_type=refresh_token` (`node_modules/@supabase/auth-js/src/GoTrueClient.ts:2503`). Nenhum código do front chama `/oauth/token`: procurei em `src/`, `workers/`, `config/` e no Worker da Cloudflare.
- Fato: `/oauth/token` é o endpoint do servidor OAuth 2.1 do Supabase, usado pelos conectores MCP autorizados em `/oauth/consent` (`src/pages/OAuthConsent.tsx`).
- Hipótese forte: o `referer https://aceleriq.online` nos logs é o Site URL que o GoTrue grava quando o pedido não traz Referer, e não prova que o pedido saiu do navegador. As 1109 falhas (582 do IP `168.194.162.48`, em rajadas de cerca de 12 a cada 10 min) têm cara de um cliente MCP (app ou `mcp-remote` na rede do dono) repetindo um refresh token OAuth morto, sem nunca desistir.
- Recomendação: identificar o conector nesse IP e reconectá-lo (nova autorização OAuth). Não dá para corrigir isso no front. Mesmo assim, o fetch do painel passou a tratar `/oauth/token` com `grant_type=refresh_token` como renovação: não aborta e não reenvia token recusado.

## Ajuste da revisão do Codex (14/11, depois de `d7204a5`)

O Codex (gpt-6-astra) revisou `d7204a5` e barrou o merge por dois P1. Os dois foram reproduzidos com o supabase-js real antes da correção (os testes novos falhavam) e passam agora.

**P1-1: a sessão nova ainda podia ser apagada.** A proteção do storage zerava `ultimaMorte` depois de segurar a primeira remoção. Com `autoRefreshToken`, o supabase-js apaga a sessão duas vezes depois de um token morto (`_callRefreshToken` e depois `_recoverAndRefresh`). A segunda apagava a sessão válida gravada por outra aba.
- Correção (`renovacaoSegura.ts`, `protegerSessaoGuardada`): `ultimaMorte` não é mais zerada. Enquanto a janela de 30 s valer e o token gravado for outro e vivo, todas as remoções são ignoradas. A remoção só apaga quando o gravado é o próprio token morto, quando a janela passou ou quando é saída de propósito (`esquecerTokensMortos`, botão sair).
- Testes: SDK real com `autoRefreshToken: true` (o SDK pede para apagar 2 vezes e a sessão `t9` continua lá); unitários com 3 remoções seguidas, janela vencida e saída de propósito.

**P1-2: renovação pendurada travava o envio na mesma aba.** Sem prazo, um refresh HTTP que não termina prende o `getSession()` seguinte na fila interna do supabase-js (`pendingInLock`), que não passa pela trava. O envio de arquivo ficava preso mesmo com o access token valendo. Era o defeito de 26/09 voltando por outro caminho.
- Correção (`renovacaoSegura.ts`, `renovarSemDuplicar`; `fetchComPrazo.ts`):
  - a renovação continua **sem abort**;
  - quando passa de 8 s no ar (`PRAZO_PARA_SOLTAR_RENOVACAO_MS`, a mesma ordem de `ESPERA_MAXIMA_MS`), quem espera é solto com `TypeError: Failed to fetch`, que o SDK trata como retryable;
  - o retry do SDK, 200 ms depois, não manda outro POST. Se o access token gravado ainda vale (com folga de 10 s), recebe a sessão gravada sem ir à rede, e o SDK solta a fila. Se não vale, recebe falha de rede de novo e o SDK tenta mais tarde. Sem isso, só a falha de rede deixaria o SDK repetindo com backoff por uns 20 s dentro da fila, e o `getSession` perto do vencimento terminaria sem sessão;
  - o pedido segue em segundo plano. Quando a resposta chega, o par novo é gravado, mas só se o storage ainda tiver o token enviado (se a pessoa saiu ou outra aba renovou, não mexe). O token velho fica registrado como trocado: um pedido atrasado com ele recebe o par novo sem rede, e o storage nunca volta a gravá-lo;
  - nunca saem duas renovações juntas deste navegador. Na mesma aba, um segundo pedido espera o primeiro (até o prazo) e decide de novo. Entre abas, quem solta por prazo deixa uma marca no `localStorage` (`aceleriq-auth-renovacao-em-voo`, só com uma impressão curta do token). A marca é regravada a cada 20 s enquanto o HTTP segue; se a aba fechar, vale por 60 s após o último pulso. Outra aba com o mesmo token não renova enquanto a marca vale;
  - a abertura continua sem refresh forçado e o `signOut` continua com scope local.
- Testes: SDK real, renovação automática pendurada (o `getSession` sai com o token que vale, 1 POST só, sem sinal de abort; depois a resposta chega e `t1` é gravado); token perto de vencer, em que o próprio `getSession` quer renovar; unitários de prazo, de segundo POST, de token vencido, de marca entre abas e de não regravar token trocado.

**Risco residual P2 (documentado, não corrigido):** sem `navigator.locks` (Safari muito antigo), a trava do login roda sem exclusão entre abas e a renovação pode sair sem trava. É o comportamento herdado do supabase-js. Na mesma aba, o controle de renovação em voo continua valendo; entre abas, só a marca do `localStorage` (que só aparece quando uma renovação passa do prazo). É aceitável nos navegadores que o painel usa hoje (Chrome, Edge e Safari atuais têm `navigator.locks`).

**Limites conhecidos do ajuste:**
- Se a resposta atrasada chegar depois de o SDK desistir, o storage recebe o par novo, mas esta aba não dispara `TOKEN_REFRESHED`. O cliente do supabase-js lê o storage a cada chamada e já usa o token novo. O estado do React só se atualiza no próximo evento.
- Se a aba que renovava fechar com o pedido no ar, as outras abas esperam a marca vencer (até 60 s após o último pulso) antes de renovar aquele token. Enquanto isso, usam o access token que ainda vale.

## Segundo ajuste da revisão do Codex (14/11, depois de `1215682`)

O Codex revisou `1215682` e confirmou que os dois P1 anteriores foram corrigidos, mas barrou o merge por dois P1 novos (reproduzidos com estados separados por aba):

**P1-3: a marca de 60 s expirava com o HTTP ainda no ar.** Depois de ~68 s, outra aba podia reenviar o mesmo refresh token, mesmo com `navigator.locks` (a primeira aba já tinha solto a trava aos 8 s). Correção: enquanto o pedido segue, a marca é regravada a cada 20 s (`INTERVALO_DA_MARCA_MS`). Só some quando a resposta chega ou a aba fecha (aí vale os 60 s do último pulso).

**P1-4: a aba B podia gravar o par velho por cima do novo.** B recebia a sessão `t0` sem rede; A terminava e gravava `t1`; o SDK de B gravava `t0` de novo. A proteção só olhava o mapa `trocados` da própria aba. Correção: ao registrar a troca, grava também uma impressão curta do token velho no `localStorage` (`aceleriq-auth-tokens-trocados`, sem o token em si, validade de 10 min). Qualquer aba recusa gravar um token já trocado.

Testes unitários cobrem os dois casos.

**P1-5 (segunda revisão, aba suspensa) e P1-6 (TTL de 10 min):** o Codex mostrou que o pulso não roda se a aba fica suspensa (timers parados) e que, depois de 10 min, a impressão compartilhada some e o par velho poderia voltar. Correção:
- a renovação segura uma trava HTTP própria (`aceleriq-auth-renovacao-em-voo`), diferente da trava do login, até o pedido terminar. Mesmo com a aba suspensa e a marca vencida, outra aba vê a trava e não reenvia. A trava do login continua sendo solta aos 8 s, então envio e `getSession` não travam;
- `setItem` também recusa um par com `expires_at` menor ou igual ao que já está gravado (token velho não sobrescreve o novo, mesmo depois do TTL da impressão). Login ou sessão nova sem `expires_at` não entram nessa regra.

Testes: aba suspensa sem pulso/marca, outra aba não manda POST; `setItem` do par velho depois de limpar a lista compartilhada não sobrescreve. O P2 sem `navigator.locks` continua residual (aí valem a marca e o pulso).

## O que muda (só front e testes)

1. **A abertura não força mais renovação.** O `getSession()` já renova sozinho, com a trava, quando faltam menos de 90 s, e o `autoRefreshToken` cuida do resto. O refresh "por precaução de JWKS" saiu.
2. **Nunca duas renovações do mesmo token neste navegador.** Quando a espera da trava estoura, a operação segue como leitura, então o envio de arquivo e a abertura do painel não falham e o defeito de 26/09 não volta. Se ela precisar renovar, o fetch espera a trava de verdade (até 20 s) e relê o storage. Se outra aba já renovou, usa o token dela. Grava o par novo antes de soltar a trava.
   - Por que não simplesmente lançar `TravaOcupada`: o supabase-js guarda a promessa do `initialize()`. Se a primeira trava da aba falhar, toda chamada de login daquela aba (inclusive o login por senha) falha até recarregar. O teste `sessao-duas-abas` mostrou isso. A renovação automática (prazo 0) continua avisando com `TravaOcupada`.
3. **A renovação não é mais abortada.** O prazo de 10 s continua no login por senha e no `/user`, mas não vale para `grant_type=refresh_token` (nem `/token`, nem `/oauth/token`).
4. **Token recusado não é reenviado.** Depois de `refresh_token_not_found` (ou `already_used`), o painel responde localmente, sem ir ao servidor. Isso acaba com a rajada vinda deste navegador.
5. **Antes de sair, o painel relê o storage.** Isso vale para a abertura e para o evento `SIGNED_OUT`: se outra aba gravou um token novo e vivo, a pessoa fica no painel. O storage também ignora o pedido de apagar a sessão quando o token que morreu já não é o que está gravado.
6. **Erro de rede, abort, timeout ou trava ocupada nunca desloga.**
7. **Toda saída é `scope: "local"`, inclusive o botão sair.** A conta é compartilhada, e sair numa aba não pode derrubar o iPhone, o Windows nem os agentes. As abas do mesmo navegador saem juntas porque dividem o storage.
8. Continua um único `createClient`, com `persistSession` e `autoRefreshToken` ligados. O `previewAuthStorage.ts` não foi mexido: só embrulhei o que ele devolve.

## Arquivos alterados

- `src/integrations/supabase/renovacaoSegura.ts` (novo): estado compartilhado (sem trava, tokens mortos), renovação dentro da trava e proteção do storage.
- `src/integrations/supabase/travaDoLogin.ts`: espera estourada passa a seguir como leitura; a renovação só sai com a trava.
- `src/integrations/supabase/fetchComPrazo.ts`: sem prazo na renovação; não reenvia token morto; a renovação de fora da trava espera a trava.
- `src/integrations/supabase/client.ts`: storage protegido, passado também para a trava.
- `src/contexts/AuthContext.tsx`: abertura sem refresh forçado, releitura do storage, saída local.
- `src/test/trava-do-login.test.ts`: atualizado. A asserção "segue sem a trava" virou "a renovação não roda sem a trava".
- `src/test/login-com-prazo.test.ts`: atualizado. A renovação não é abortada; token morto não é reenviado; proteção do storage.
- `src/test/sessao-duradoura.behavior.test.tsx` (novo): AuthContext (abertura sem refresh, rede/trava não deslogam, releitura do storage, scope local).
- `src/test/sessao-duas-abas.test.ts` (novo): supabase-js de verdade, 3 abas, servidor com rotação estrita, trava presa e servidor lento.

## Testes

- Auth/trava/login (com `abertura-do-painel`): 5 arquivos, 38 testes, todos passando. Depois do ajuste do Codex: 5 arquivos, 49 testes, todos passando.
- Contra o código antigo, `sessao-duas-abas` falha nos dois cenários do incidente (`ok:t0->t1`, depois `morto:t0`, e `refresh_token_not_found` após o abort). Com a correção, passa.
- Suíte inteira: 6 falhas, todas iguais no `main` sem este lote (baseline): `mcc-motor-claude-code`, `biblioteca-da-casa`, `compartilhados-no-limite-do-lovable`, `mcp-erros-que-ensinam`, `mesa-campanha-completa`, `padrao-visual-catraca`.
- Typecheck: `tsconfig.app` e `tsconfig.node` limpos. Em `tsconfig.test`, 3 erros antigos em arquivos não tocados (`src/test/produto-crm-email.test.tsx` e `workers/motor-codigo/lib/opencode.ts`).
- Build: `npm run build` ok (só o aviso antigo de chunk grande). `git diff --check` ok.
- Depois do ajuste do Codex: suíte inteira com as mesmas 6 falhas de baseline e nenhuma nova (12324 testes passando). `tsconfig.app`, `tsconfig.node` e `tsconfig.test` sem erros. Build ok. Lint dos arquivos tocados limpo.
- Lint dos arquivos tocados: nenhum erro novo. Os que aparecem (`any` em linhas antigas e `only-export-components`) já existiam.

## O que NÃO entra no ar ainda

- Nada vai ao ar até o merge e o Publish no Lovable, os dois manuais. Antes disso, o coordenador espera o build verde e a revisão do Codex.
- Nenhuma escrita no Supabase, nenhuma mudança de Auth, nenhuma troca de senha, nenhum CAPTCHA.
- A Edge Runtime/`mcp-server` (recover e login com a conta da casa) e a reconexão do conector MCP que repete o token OAuth morto ficam para outros lotes.

## Proteção do login: recomendação, nada implementado

O que vimos: as sessões não expiram por tempo, a rotação está ligada e a janela de reuso não foi lida (o padrão é cerca de 10 s). O rate limit nativo permite 1800 renovações por hora por IP, com rajada de 30. Ele não teria barrado as 5 tentativas e não impede adivinhar senha devagar.

Precisa de ok do Almir antes de aplicar:

1. A mais simples: ligar o CAPTCHA Turnstile no Auth (dashboard) e no formulário de login.
2. Um alerta (cron ou hook lendo `auth_logs`) quando a mesma conta ou IP tiver várias `invalid_credentials` em poucos minutos. Seria um aviso no painel ou por e-mail, sem trocar senha sozinho.
3. Não apertar o rate limit de renovação agora, porque há a rajada de token morto do conector MCP. Não trocar a senha.

## Riscos e rollback

- Sem o refresh "por JWKS" na abertura: se a chave de assinatura for trocada e a antiga revogada na hora, o painel só renova quando o token estiver perto de vencer. A troca de chave no Supabase mantém a anterior válida, então o risco é baixo.
- O `SIGNED_OUT` mantido por causa de uma sessão viva no storage pode deixar o realtime com a chave pública até o próximo `TOKEN_REFRESHED`.
- Rollback: reverter o commit do PR. Não há SQL nem migração.

## Preview (checklist)

1. Abrir o painel em 3 abas logadas. No DevTools > Network, filtrar `token?grant_type=refresh_token`: não deve sair renovação ao abrir com token válido.
2. Deixar uma aba aberta mais de 1 h: deve sair uma renovação por vez, nunca duas iguais juntas.
3. Rede em "Offline" por 1 min e voltar: continua logado.
4. Botão sair: encerra este navegador. O iPhone e as outras sessões continuam (conferir em `auth.sessions` só lendo).
5. Enviar print ou arquivo com várias abas abertas: não falha com "LockManager lock timed out".
