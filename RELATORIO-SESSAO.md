# Relatório: queda de sessão do painel (14/11/2026)

PR: https://github.com/oalmirbueno/convertai-command-center/pull/134 (draft, contra `main`, sem merge)
Branch: `infra/sessao-painel-duradoura`
Commit: `267e766` (código e testes); este relatório vai num commit separado

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

- Auth/trava/login (com `abertura-do-painel`): 5 arquivos, 38 testes, todos passando.
- Contra o código antigo, `sessao-duas-abas` falha nos dois cenários do incidente (`ok:t0->t1`, depois `morto:t0`, e `refresh_token_not_found` após o abort). Com a correção, passa.
- Suíte inteira: 6 falhas, todas iguais no `main` sem este lote (baseline): `mcc-motor-claude-code`, `biblioteca-da-casa`, `compartilhados-no-limite-do-lovable`, `mcp-erros-que-ensinam`, `mesa-campanha-completa`, `padrao-visual-catraca`.
- Typecheck: `tsconfig.app` e `tsconfig.node` limpos. Em `tsconfig.test`, 3 erros antigos em arquivos não tocados (`src/test/produto-crm-email.test.tsx` e `workers/motor-codigo/lib/opencode.ts`).
- Build: `npm run build` ok (só o aviso antigo de chunk grande). `git diff --check` ok.
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
