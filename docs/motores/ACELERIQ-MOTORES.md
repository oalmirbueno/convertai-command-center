# Aceleriq Motores

Frente SUP, 01/10/2026. Pedido do dono: "Quero que, sempre que eu abrir o painel, dê para instalar as dependências em qualquer computador, para não depender só deste. E este tem que abrir junto, mas sem ficar com os terminais abertos, que não faz sentido. Tem que ser algo mais bonito e invisível, mas funcionando."

O Aceleriq Motores é um supervisor invisível dos três workers (render, motor de código e navegador do agente). Ele abre junto com o Windows sem janela nenhuma, sobe de novo o worker que cair, mostra um ícone perto do relógio e se atualiza sozinho. O painel instala os motores em qualquer computador com um código de pareamento.

O jeito antigo (`workers\ligar\*.cmd`, uma janela por worker) continua funcionando: veja `LIGAR-OS-MOTORES.md`.

## 1. Como funciona

```
Pasta Inicializar do Windows: "Aceleriq Motores.lnk"
  └─ conhost.exe --headless          (console sem janela)
      └─ node lancador.mjs           (estável: escolhe a versão, volta se a nova cair)
          └─ node workers\supervisor\principal.ts   (o supervisor)
              ├─ node workers\render\principal.ts         (sem janela, canal IPC)
              ├─ node workers\motor-codigo\worker.ts      (sem janela, canal IPC)
              ├─ node workers\computador\principal.ts     (sem janela, canal IPC)
              └─ powershell bandeja.ps1                   (o ícone, sem janela)
```

Tudo fica em `%LOCALAPPDATA%\Aceleriq\Motores`:

| Arquivo ou pasta | O que é |
|---|---|
| `lancador.mjs` | o lançador estável; o atalho aponta para ele |
| `atual.json` | a versão em uso, a anterior, se a nova está em prova e as recusadas |
| `maquina.json` | id da máquina no painel, nome, motores desta máquina, endereço do projeto e do painel |
| `cofre.dat` | as chaves, protegidas pelo DPAPI do Windows (só este usuário nesta máquina abre) |
| `versoes\<versao>\workers\...` | o código de cada versão |
| `deps\<motor>-<hash>\node_modules` | dependências por package-lock; versões com o mesmo lock reaproveitam |
| `logs\` | `supervisor.log`, `render.log`, `codigo.log`, `navegador.log` e `lancador.log`, com rotação (5 MB, 5 arquivos) |

**O supervisor:**
- Sobe cada worker como filho, sem janela (`windowsHide`, saída por cano) e com um canal IPC (`workers/supervisor/canal.ts`). Pelo canal o worker diz "ocupado" e "ocioso" e atende o "parar" com calma.
- Worker que cai sobe de novo depois de 2 s, 4 s, 8 s e assim por diante, até 5 min. Se ficar de pé mais de 2 min, a conta zera.
- Nunca derruba um worker ocupado: um "construir" do motor de código, um render ou uma tarefa do navegador sempre terminam antes de qualquer parada (Reiniciar, Pausar, Sair, atualização, máquina removida).
- Bate o ponto da máquina a cada 30 s (`motores_maquina_sinal`). Na volta recebe os motores desta máquina, se ela foi removida e qual é a versão publicada.
- Lê as chaves dos provedores (OpenRouter, OpenAI, Anthropic, Vercel) do cofre do painel (Configurações › Chaves e custos, RPC `chaves_do_cofre`). Se faltar alguma lá, usa a guardada no cofre DPAPI desta máquina e, por último, a do ambiente. As chaves vivem só na memória dos workers. Se o cofre do painel mudar, cada worker reinicia quando ficar ocioso.

**O ícone na bandeja:**
- Verde: tudo ligado (a dica mostra "Trabalhando: motor de código" quando há trabalho).
- Amarelo: atenção (reiniciando, pausado, sem internet com o painel, atualizando).
- Vermelho: parado (um motor caindo, falta parear, máquina removida no painel).
- Menu: Abrir o painel, Estado dos motores (cada motor e "Ver no painel"), Reiniciar, Pausar ou Retomar, Ver registros e Sair.
- O ícone pode ficar nos ícones ocultos (^). Para deixar sempre à vista: Configurações do Windows › Personalização › Barra de tarefas › Outros ícones da bandeja do sistema › Aceleriq Motores.

**Abrir navegador ou pasta só por clique.** Abrir o painel, o Estado dos motores ou a pasta de registros só acontece quando o dono clica no menu da bandeja. É no máximo uma abertura a cada 10 s. Nunca acontece no início, no controle local (`--comando`), em teste ou em laço. Em 01/10, o comando "estado" do controle abria o painel a cada consulta, e o teste ponta a ponta, que consultava a cada segundo, abriu dezenas de abas. Desde então o controle só lê (`Supervisor.comando`), o menu tem freio (`abrirComFreio`) e o teste `testes/sem-navegador.test.ts` garante isso. Com `ACELERIQ_SEM_NAVEGADOR=1`, nada abre.

## 2. Instalar numa máquina nova (pelo painel)

No painel: Configurações › Estado dos motores › Máquinas › **Instalar os motores neste computador** (só o admin vê).

1. Baixe o instalador e abra com dois cliques. O Windows pede para confirmar, porque o arquivo veio da internet.
2. Quando ele pedir, digite o código que o painel mostra. O código vale 10 minutos e uma vez só.
3. Pronto: o ícone da Aceleriq aparece perto do relógio e a máquina surge na lista em até 30 s.

O instalador (`instalar-aceleriq-motores.cmd`, montado por `src/lib/motores/montarInstalador.ts` a partir de `workers/instalador/instalar-motores.ps1`):
- confere o próprio script por sha256 antes de rodar (arquivo alterado no caminho não roda). O painel mostra o sha256 do arquivo; para conferir: `certutil -hashfile instalar-aceleriq-motores.cmd SHA256`;
- confere ou instala o Node LTS (24 ou mais novo), o ffmpeg (se a máquina vai renderizar) e o Git (se vai rodar o motor de código) pelo `winget`, com a confirmação do Windows;
- troca o código pela chave de serviço (função `motores-parear`) e grava a chave direto no cofre DPAPI;
- baixa o pacote dos workers por URL assinada (1 h) e confere o sha256;
- extrai em `versoes\<versao>`, roda `npm ci` em cada motor desta máquina e baixa o Chromium do navegador do agente;
- cria o atalho invisível na pasta Inicializar e liga.

Dá para escolher no painel quais motores a máquina nova vai rodar (numa máquina fraca, só o navegador, por exemplo). Depois, a lista de máquinas permite mudar.

Antes da primeira instalação é preciso haver uma versão publicada (seção 4).

## 3. Migrar esta máquina (DESKTOP-3A5EAKC, onde os workers rodam em janelas)

Depois que este código estiver no main:

```
git -C C:\AI\aceleriq-workers pull --ff-only
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\AI\aceleriq-workers\workers\instalador\instalar-motores.ps1 -Modo migrar-desta-maquina -Origem C:\AI\aceleriq-workers -Ensaiar
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\AI\aceleriq-workers\workers\instalador\instalar-motores.ps1 -Modo migrar-desta-maquina -Origem C:\AI\aceleriq-workers
```

O primeiro é um ensaio: ele prepara tudo (cofre, cópia, dependências e atalho) e só mostra quais janelas fecharia e o que está em curso. O segundo migra de verdade:

1. Passa as chaves das variáveis do usuário para o cofre DPAPI: `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID` e `VERCEL_TOKEN`. O valor nunca aparece.
2. Copia os workers do clone para `versoes\<versao>`, sem `node_modules`, `.env` nem `tmp`, e instala as dependências. O `npm ci --prefer-offline` usa o cache do npm.
3. Cria o atalho invisível na pasta Inicializar.
4. Confere no banco se algum worker antigo está trabalhando (motor de código executando, render rodando, navegador executando). Se estiver, espera, conferindo a cada 20 s, por até 3 horas. Com `-NaoEsperar`, avisa e sai sem fechar nada.
5. Com tudo ocioso, fecha os workers antigos (com a árvore, inclusive as prévias do motor de código) e as janelas de `ligar-*.cmd` e `ligar-motores.ps1`. As abas do Terminal podem ficar com "processo encerrado"; é só fechar.
6. Liga o supervisor. A máquina se registra no painel na primeira batida, com o mesmo nome dos workers no banco (`DESKTOP-3A5EAKC-render`, `agencia-DESKTOP-3A5EAKC` e `DESKTOP-3A5EAKC-navegador`).

As chaves continuam também nas variáveis do usuário, para os atalhos antigos. Para deixar só no cofre, rode de novo com `-LimparVariaveis`. Atalho com dois cliques: `workers\instalador\migrar-desta-maquina.cmd`.

## 4. Publicar uma versão e a atualização sozinha

```
npm run publicar:motores
```

O comando monta o zip da árvore `workers/` do HEAD (`git archive`). A versão são os 10 primeiros caracteres do hash da árvore: código igual dá versão igual. O zip sobe no bucket privado `motores-pacotes` e a versão é registrada em `motores_versoes` (`motores_versao_publicar`). Com `--se-mudou`, nada sobe se a versão já existe. A chave vem do ambiente ou do cofre DPAPI desta máquina. O `npm run publicar` do site não mudou: rode `publicar:motores` quando o merge mexer em `workers/`.

Em cada máquina:
1. A batida traz a versão publicada. O supervisor baixa o pacote, confere o sha256, extrai e prepara as dependências enquanto os motores seguem trabalhando.
2. Com todos os motores ociosos ao mesmo tempo, ele os para com calma, aponta `atual.json` para a nova (em prova) e sai com o código 75. O lançador sobe a versão nova.
3. Se a nova derrubar um motor 3 vezes nos primeiros 3 min, ou o supervisor novo cair nos primeiros 2 min, a máquina volta para a anterior e recusa a nova (não tenta de novo).
4. Se a nova se firmar, as versões e dependências sem uso são apagadas. A anterior fica.

Para tirar uma versão ruim de circulação: `update motores_versoes set retirada_em = now() where versao = '...'`. A vigente volta a ser a anterior. As máquinas que já trocaram seguem nela até sair outra.

## 5. No painel

Configurações › Estado dos motores › **Máquinas** (só admin):
- cada máquina com ponto e rótulo (Ligada, Atenção, Pausada, Parado, Desligada, Sem sinal), versão, último sinal e o que está trabalhando;
- o aviso "desatualizada" quando a versão da máquina não é a publicada;
- aberta, a linha mostra os motores desta máquina (Render, Código e Navegador, para ligar ou desligar), a situação de cada um e **Remover máquina**;
- o botão de instalar, com o passo a passo em 3 linhas, o código e os códigos abertos (com Revogar).

## 6. Segurança

- **Código de pareamento:** 8 caracteres sem 0, O, 1, I e L, válido por 10 min e uma vez só. Só o admin gera, até 5 abertos por admin. O banco guarda só o HMAC-SHA256 do código (`MOTORES_PAREAR_SEGREDO` ou, sem ele, a própria chave de serviço). A troca registra máquina, quem gerou e quando em `motores_auditoria`. Toda recusa também é registrada (inválido, vencido, revogado, já usado).
- **Limite de tentativas:** 8 erros por origem (IP com HMAC) em 15 min, ou 60 erros no total, barram a troca por 15 min.
- **A chave de serviço** sai só na resposta 200 de uma troca bem-sucedida, por HTTPS, sem cache (`Cache-Control: no-store`). Nunca entra em log: os logs da função passam por `semAChave`, e os do supervisor por `semSegredo`, que tira os valores conhecidos e os formatos de chave (JWT, `sb_secret_`, `sk-`). Os testes conferem a chave fora do log e fora da segunda resposta.
- **Na máquina** a chave fica só no cofre DPAPI (escopo do usuário, com entropia própria). Nunca vai para texto, variável de ambiente nova ou registro. O instalador grava direto no cofre e apaga da memória do script.
- **Remover máquina** marca a máquina como revogada. Na próxima batida (até 30 s), o supervisor dela para com calma, apaga o cofre e não liga mais. Isso depende de a máquina estar ligada e honesta. **Máquina perdida ou roubada:** troque a chave de serviço no Supabase (Project Settings › API Keys). As outras máquinas voltam com um código novo, ou com `migrar` se a chave nova estiver nas variáveis do usuário.
- **Próximo passo de segurança:** uma chave por máquina. As chaves secretas novas do Supabase (`sb_secret_...`) podem ser criadas e revogadas uma a uma pela Management API, o que exige um token pessoal no servidor. Com isso, remover uma máquina invalidaria de verdade a chave dela.

## 7. Comandos úteis (nesta máquina)

```
node %LOCALAPPDATA%\Aceleriq\Motores\lancador.mjs --comando estado      (só lê; nunca abre nada)
node %LOCALAPPDATA%\Aceleriq\Motores\lancador.mjs --comando reiniciar
node %LOCALAPPDATA%\Aceleriq\Motores\lancador.mjs --comando pausar      (e retomar)
node %LOCALAPPDATA%\Aceleriq\Motores\lancador.mjs --comando sair        (espera os trabalhos em curso)
powershell -ExecutionPolicy Bypass -File workers\instalador\instalar-motores.ps1 -Modo conferir
powershell -ExecutionPolicy Bypass -File workers\instalador\instalar-motores.ps1 -Modo desinstalar [-ApagarTudo]
```

Para não abrir junto com o Windows: Gerenciador de Tarefas › Aplicativos de inicialização › Aceleriq Motores › Desabilitar.

## 8. Por que assim

- **Ícone: NotifyIcon do .NET num PowerShell oculto** (`bandeja/bandeja.ps1`), falando com o supervisor por cano. O systray2 e similares baixam pelo npm um binário em Go, sem assinatura, que antivírus costuma barrar e que está sem manutenção. O PowerShell 5.1 e o WinForms vêm em todo Windows 10 e 11, não há dependência para instalar e o ícone que cair volta sozinho sem derrubar os motores. O custo é um processo a mais (uns 40 MB).
- **Início: atalho na pasta Inicializar com `conhost.exe --headless`**. Não pede administrador (criar tarefa agendada "ao fazer logon" costuma pedir), aparece em Aplicativos de inicialização para o dono desligar e não usa VBScript, que o Windows está aposentando. O `conhost --headless` dá ao lançador um console sem janela, e os filhos (com `windowsHide`) e os netos de terceiros (opencode, npm, ffmpeg, Chrome) herdam um console oculto. O teste `janela.test.ts` confere pela API do Windows (EnumWindows) que nenhum processo da árvore tem janela visível.
- **Dois processos Node (lançador e supervisor):** o lançador quase nunca muda, então o próprio supervisor pode ser atualizado e voltar de versão sem que o atalho do Windows mude.
- **Pacote no Storage por versão, e não git na máquina:** o repositório é privado e não pede credencial do git em cada computador. O pacote é conferido por sha256, e a URL assinada vale 1 h (pareamento) ou 15 min (atualização).

## 9. macOS (próximo passo)

O código já separa o que é do Windows. Falta:
- **Início:** um LaunchAgent do usuário em `~/Library/LaunchAgents/online.aceleriq.motores.plist` com `ProgramArguments` = node e `lancador.mjs`, `RunAtLoad` verdadeiro e `KeepAlive` falso (o lançador já cuida das quedas). Instala com `launchctl bootstrap gui/$(id -u) <plist>`. Não abre janela.
- **Cofre:** Keychain (`security add-generic-password -s aceleriq-motores -a <nome> -w` e `find-generic-password -w`), atrás da mesma interface `Cofre` de `segredos.ts`. Hoje, fora do Windows, o supervisor usa só o ambiente.
- **Ícone:** um item de barra de menus (`NSStatusItem`) num auxiliar Swift pequeno, compilado no instalador, com o mesmo protocolo de linhas JSON de `bandeja.ps1`. Hoje, fora do Windows, a bandeja é nula.
- **Instalador:** um `instalar-motores.command` (shell) com Homebrew no lugar do winget (`brew install node ffmpeg git`) e o mesmo pareamento.
- O que já funciona no macOS: lançador, supervisor, controle (socket na pasta dos motores), pacote (o `tar` do macOS lê zip), dependências (link simbólico no lugar da junção) e registros.

## 10. Testes

- `cd workers/supervisor && npm run teste` (node:test): canal, registros com rotação e sem chave, filhos (reinício crescente, parada limpa que espera o trabalho, ocioso surdo encerrado no prazo), supervisor (chaves, motores por máquina, máquina removida, pausar, freio de abertura, controle que nunca abre nada), atualização (só com todos ociosos, sha256, volta de versão, limpeza), lançador (volta de versão e troca), cofre DPAPI, nenhuma janela, banco (PGlite: código de uso único, prazo, revogação, limite, auditoria, admin, RLS) e nenhum navegador aberto em teste.
- `src/test/sup-aceleriq-motores.test.tsx` (vitest): função de pareamento (só admin, HMAC, HTTPS, uso único, chave fora do log e da segunda resposta), o instalador .cmd e a tela das máquinas.
- Ponta a ponta do instalador, numa pasta temporária, com pareamento falso (só Windows; não toca no perfil de verdade e sobe o supervisor com `ACELERIQ_SEM_NAVEGADOR=1`): `node workers/instalador/testes/ponta-a-ponta.ts --motores render` (com `npm ci` de verdade) ou `--motores "" --sem-npm` (rápido).
