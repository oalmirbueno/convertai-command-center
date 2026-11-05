# Comercial pelo WhatsApp oficial (ACQ-06 e ACQ-07)

O Mercúrio fala com lead novo pelo WhatsApp comercial da Aceleriq usando a **Cloud API da Meta** (a API
oficial), com **modelos de mensagem aprovados**. O n8n orquestra; o painel continua sendo a fonte da fila,
das regras e da conversa (ferramentas `aceleriq_comercial_*` do MCP).

| Fluxo | O que faz | Gatilho |
|---|---|---|
| `ACQ-06-Comercial-Primeiro-Contato` | Lê a fila do Mercúrio, escolhe quem está pronto e manda o modelo de primeiro contato | dias úteis, 9h00 a 17h40, a cada 20 min |
| `ACQ-07-Comercial-Respostas` | Webhook do WhatsApp: registra a resposta, o Jev julga a intenção, "pare" grava `nao_contatar`, o Mercúrio responde na janela de 24 h e avisa a Caixa quando o lead avança | webhook `GET`/`POST` `/webhook/acq07-whatsapp` |

## Modo seguro (como os fluxos nascem)

Em `config/ambientes.json`, todos os ambientes têm `dry_run_por_workflow: { "ACQ-06": true, "ACQ-07": true }`.
Enquanto for `true`:

- a Meta **não** é chamada;
- toda escrita no painel (registrar mensagem, Caixa, `nao_contatar`) vira **simulação** no adaptador (ACQ-00);
- o que seria enviado fica gravado em `acq_n8n.eventos` (tipos `comercial_*_simulado`, com o texto exato).

O transporte só liga quando **as quatro** coisas existirem:

1. `dry_run_por_workflow` do fluxo em `false` (ambiente `production`);
2. as escritas `aceleriq_comercial_registrar_mensagem`, `aceleriq_comercial_avisar_caixa` e
   `aceleriq_update_opportunity` em `escritas_liberadas` de `production` (segunda trava, de propósito);
3. `comercial.phone_number_id` preenchido;
4. para o ACQ-06, o modelo marcado `"aprovado": true` em `comercial.modelos` (depois que a Meta aprovar).

Sem a credencial da Meta, o nó HTTP falha e nada é marcado como enviado.

## Como funciona

**ACQ-06 (primeiro contato)**
1. A cada 20 min em dia útil, lê `aceleriq_comercial_fila` (operador `mercurio`). Mercúrio desligado, fora de 9h-18h
   de São Paulo ou fim de semana: não faz nada.
2. Pronto para primeiro contato = está na fila do Mercúrio (foi "entregue ao Mercúrio"), sem nenhuma mensagem
   ainda, com celular (fixo fica de fora; celular sem WhatsApp confirmado entra desde 04/11), sem `nao_contatar`, sem
   `qualificacao.client_id` (lead de site de cliente) e **com fato observado** (ver abaixo). Ordem: nota de
   encaixe do Jev. Limite: o menor entre o `restam_hoje` do painel (teto de 20) e 5 por rodada.
3. Antes de chamar a Meta, reivindica a tentativa do dia no Postgres (`acq_n8n.eventos`): uma tentativa por lead por
   dia; depois de **aceita** ou **incerta**, nunca mais.
4. Manda o modelo (`type: template`) com `{{1}}` = nome da empresa e `{{2}}` = fato observado.
5. Só com o `wamid` devolvido pela Meta registra a saída em `aceleriq_comercial_registrar_mensagem`
   (`id_externo` = wamid). Erro 4xx da Meta = recusado (nada saiu, tenta outro dia); timeout/5xx = incerto
   (incidente alto, nunca reenvia sozinho). Meta aceitou e o painel falhou = incidente alto, sem reenvio.

**Fato observado**, nesta ordem: `qualificacao.fato_observado` (texto livre que a equipe ou o Hermes gravar);
fato **gravado** de campo `presenca_digital` ou `problema` (`aceleriq_comercial_registrar_fato`); e, para lead da
Máquina sem site nas fontes, "não encontrei um site próprio da empresa nas buscas" (ou "vocês têm Instagram, mas não
encontrei um site próprio da empresa"). O texto entra depois de "reparei que": precisa começar em minúscula e ser uma
frase só. `qualificacao.presenca_digital` é anotação interna e nunca vai para o lead (a simulação de 05/11 mostrou
isso virando mensagem). Lead **com** site e sem fato gravado fica de fora: sem fato não há mensagem personalizada.

**ACQ-07 (respostas)**
1. `GET`: responde o `hub.challenge` só se o `hub.verify_token` bater com o guardado.
   `POST`: responde 200 na hora e confere a assinatura `X-Hub-Signature-256` com o app secret; sem app secret ou
   com assinatura errada, nada é processado (incidente).
2. Cada mensagem é tratada uma vez (a Meta reenvia webhooks). Acha o lead pelo número (DDD + 8 últimos dígitos,
   porque o wa_id brasileiro pode vir sem o 9) na fila do Mercúrio e registra a **entrada** no painel.
3. O **Jev** (Choice `intencao`: interessado, pergunta, não agora, pare, outro; Noul `avancou`: pediu preço,
   proposta, reunião ou pessoa) julga a mensagem. Botões do modelo ("Quero o diagnóstico", "Não tenho interesse")
   são lidos direto.
4. **Pare** (Jev com probabilidade ≥ 0,4, botão ou frase que o próprio painel reconhece): grava
   `qualificacao.nao_contatar = "sim"` e **não responde**. Interessado ou pediu para avançar:
   `aceleriq_comercial_avisar_caixa` (tipo `avancou`). Pergunta, interesse, "não agora" e o primeiro "oi" de quem
   chegou sozinho: o Mercúrio responde em texto livre.
5. A resposta é redigida pelo modelo de linguagem (OpenRouter, `anthropic/claude-sonnet-5.5`) com as
   `orientacoes` do `commercial_agente_config` (vêm na fila), até 700 caracteres, sem link que não esteja nas
   orientações. Só sai dentro da janela de 24 h da última mensagem do lead; vai pela Cloud API e a saída é
   registrada com o wamid.

Tudo que acontece fica em `acq_n8n.eventos` (workflow `ACQ-06`/`ACQ-07`); o que precisa de gente fica em
`acq_n8n.incidentes`.

## O que o Almir faz na Meta

> Antes de tudo, escolha o número. **Coexistência:** a Meta permite usar o mesmo número no app WhatsApp Business
> e na Cloud API ao mesmo tempo, com o histórico sincronizado, **mas só pelo Cadastro Incorporado (Embedded
> Signup)** de um app configurado para isso (o Brasil não está na lista de países excluídos, conferido na
> documentação da Meta em 30/10/2026). Pelo caminho comum ("Adicionar número de telefone" no Gerenciador do
> WhatsApp), o número é registrado na API e **deixa de funcionar no app** (a Meta diz que um número fica numa
> plataforma por vez). Não conferi se a BM da Aceleriq já oferece a opção de coexistência na tela: se a tela pedir
> para registrar o número sem mostrar "conectar conta existente do WhatsApp Business", **pare**, porque vai perder
> o app nesse número. O caminho mais seguro é um **número novo** só para o comercial da API.
> Com coexistência, o que você mandar pelo app chega à API em outro tipo de aviso (`smb_message_echoes`) que o
> ACQ-07 **ainda não lê**: o Mercúrio não vai ver o que você respondeu pelo app.

1. **Conta do WhatsApp Business na BM** `888502683024626`: em business.facebook.com > Configurações do negócio >
   Contas > Contas do WhatsApp, use a conta existente ou crie uma ("Aceleriq"). Aceite os Termos da Plataforma
   do WhatsApp Business no banner do Gerenciador do WhatsApp (sem isso o registro do número falha).
2. **Adicionar o número comercial** em Gerenciador do WhatsApp > Números de telefone > Adicionar (nome de exibição
   "Aceleriq", categoria marketing/serviços), verificar por SMS ou ligação e **registrar** com um PIN de 6
   dígitos (verificação em duas etapas, obrigatória na Cloud API). Se a tela não registrar sozinha:
   `POST https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/register` com
   `{"messaging_product":"whatsapp","pin":"<6 dígitos>"}`.
3. **Pegar os IDs** no Gerenciador do WhatsApp (ou em developers.facebook.com > app > WhatsApp > Configuração da
   API): `phone_number_id` (identificação do número de telefone) e `waba_id` (identificação da conta do WhatsApp
   Business). Eles não são segredo: me passe os dois e eu ponho em `config/ambientes.json` → `production.comercial`.
4. **Token do usuário do sistema "Aceleriq Trafego"**: Configurações do negócio > Usuários do sistema > Aceleriq
   Trafego > Atribuir ativos: a conta do WhatsApp (controle total) e o app. Depois "Gerar token" para o app, com
   validade **Nunca**, permissões `whatsapp_business_messaging` e `whatsapp_business_management`. Copie e não
   cole em nenhum chat nem arquivo.
5. **App secret**: developers.facebook.com > o app > Configurações do app > Básico > Chave secreta do app
   (é ele que assina os webhooks).
6. **Modelos de mensagem**: Gerenciador do WhatsApp > Modelos de mensagem > Criar modelo, categoria
   **Marketing**, idioma **Português (BR)**, com os textos abaixo. Quando a Meta aprovar, me avise para marcar
   `"aprovado": true` (o nome tem de ser exatamente o da config).
7. **Webhook** (depois que o ACQ-07 estiver importado e **publicado** no n8n): developers.facebook.com > o app >
   WhatsApp > Configuração > Webhook:
   - URL de retorno: `https://blue-fly-822772.hostingersite.com/webhook/acq07-whatsapp`
   - Token de verificação: o mesmo texto que você guardou no passo do n8n (abaixo).
   - Assinar o campo **messages**.
   - Assinar o app na conta do WhatsApp: `POST https://graph.facebook.com/v21.0/<WABA_ID>/subscribed_apps` com o
     token (sem isso os avisos não chegam). Atenção: cada app da Meta tem **uma** URL de webhook; se o app já usa
     webhook de WhatsApp para outra coisa, use outro app ou a URL de substituição por conta (`override_callback_uri`).

## O que o Almir faz no n8n (https://blue-fly-822772.hostingersite.com)

Credenciais (Credentials > Add credential), com estes nomes exatos:

| Nome | Tipo | Valor |
|---|---|---|
| `ACQ WhatsApp Cloud API (Meta)` | Bearer Auth | o token do usuário do sistema (passo 4) |
| `ACQ OpenRouter (Mercúrio)` | Bearer Auth | chave do OpenRouter (openrouter.ai > Keys); defina um limite de gasto na chave |
| `TypeSafe Jev (servidor)` | Bearer Auth | chave da TypeSafe (a mesma da variável `TYPESAFE_API_KEY`) |

Já existem e são reaproveitadas: `ACQ MCP Aceleriq (máquina n8n)` e `ACQ Estado (Postgres acq_n8n)`.

Segredos do webhook (verify token e app secret) ficam no banco de controle do n8n, não no fluxo, para não se
perderem a cada importação. No SQL Editor do Supabase (projeto do painel), uma vez:

```sql
select acq_n8n.cursor_avancar('ACQ-07', 'segredos_webhook', 0,
  jsonb_build_object('verify_token', '<invente um texto longo, só letras e números>',
                     'app_secret',   '<chave secreta do app, passo 5>'));
-- para trocar depois: leia a versão e avance com ela
-- select acq_n8n.cursor_ler('ACQ-07', 'segredos_webhook');
-- select acq_n8n.cursor_avancar('ACQ-07', 'segredos_webhook', <versao>, jsonb_build_object(...));
```

Ordem para ligar (cada passo pede o seu ok):

1. Gerar e importar como rascunho: `node build/gerar.mjs --ambiente production` e importar ACQ-06/07. O
   `ACQ-00-Ferramenta-Aceleriq` da nuvem **também precisa ser reimportado**, porque a lista de ferramentas
   permitidas (com as comerciais) vai embutida nele; hoje ele está publicado e o importador
   (`tools/importar-homologacao.mjs`) se recusa a mexer em fluxo publicado.
2. Publicar o ACQ-07 (registra a URL do webhook) e cadastrar o webhook na Meta (passo 7). Mande um "oi" do seu
   celular para o número: com o dry-run ainda ligado, o fluxo registra e simula a resposta (veja em
   `acq_n8n.eventos`).
3. Entregar alguns leads ao Mercúrio (Máquina de leads "Entregar ao Mercúrio" ou CRM): hoje 0 dos 33 leads têm
   `agente_slug`, então a fila está vazia.
4. Publicar o ACQ-06 ainda em dry-run por um dia útil e conferir as simulações.
5. Ligar de verdade: `phone_number_id` e `waba_id` na config, `"aprovado": true` nos modelos aprovados,
   `dry_run_por_workflow` em `false`, as três escritas em `escritas_liberadas` de produção, gerar e importar.

## Modelos de mensagem para submeter

**1. `aceleriq_primeiro_contato_mercurio`** (Marketing, Português BR; em 04/11 substituiu `aceleriq_diagnostico_primeiro_contato`, porque o site diz que a Aceleriq não é agência)

Corpo:

> Oi, {{1}}, tudo bem? Aqui é o Mercúrio, assistente comercial da Aceleriq, de marketing e tecnologia. Olhei a
> presença de vocês na internet e reparei que {{2}}. Fazemos um diagnóstico gratuito do site e da presença online,
> mostrando o que pode melhorar para atrair mais clientes. Posso preparar o de vocês?

Rodapé: `Para não receber mais, toque em Não tenho interesse.` (a Meta limita o rodapé a 60 caracteres)
Botões de resposta rápida: `Quero o diagnóstico` · `Não tenho interesse`
Exemplos para a Meta: {{1}} = `Pet Shop Exemplo`; {{2}} = `não encontrei um site próprio da empresa nas buscas`.

**2. `aceleriq_retomada_conversa`** (Marketing, Português BR)

Corpo:

> Oi, {{1}}! Aqui é o Mercúrio, da Aceleriq. Falei com vocês há alguns dias sobre o diagnóstico gratuito do site e
> da presença online. Ainda faz sentido para vocês? Se não for o momento, tudo bem, é só me avisar.

Rodapé: `Para não receber mais, toque em Não tenho interesse.`
Botões de resposta rápida: `Quero o diagnóstico` · `Não tenho interesse`
Exemplo: {{1}} = `Pet Shop Exemplo`.

A retomada está pronta no ACQ-06, mas **desligada** (`comercial.retomada.ativa: false`): uma vez só, para quem
recebeu o primeiro contato, não respondeu nada e está há 4 dias sem resposta.

## Testes

`npm test` roda `test/comercial.test.mjs`: a lógica pura e os dois fluxos gerados executados no simulador local
(`tools/simulador-n8n.mjs`), com Postgres real e painel, Meta, Jev e modelo de linguagem falsos
(`fixtures/comercial-teste.mjs`). Nada chama a Meta, o OpenRouter, a TypeSafe ou o painel de produção.
O simulador não é o n8n: os fluxos ainda não rodaram no n8n de verdade (ver "Riscos").

## Riscos e limites conhecidos

- **Não rodou no n8n de verdade.** A configuração dos 49 nós passou no `validate_node_config` da instância, mas a
  execução foi só no simulador. Pontos a conferir na primeira execução real: `this.helpers.getBinaryDataBuffer`
  com o "Raw Body" do webhook (sem ele, a assinatura falha e nada é processado: falha segura), o `itemMatching`
  depois dos nós HTTP, e o nó que recebe de dois caminhos (roda uma vez por caminho).
- **Corrida no teto:** o ACQ-06 confere o `restam_hoje` antes de mandar; se o Hermes fizer primeiro contato no
  mesmo minuto, o teto de 20 pode passar em poucos. O painel recusa o registro (vira incidente alto).
- **Fila limitada a 100 leads** (por `updated_at`): número de lead fora dos 100 primeiros não é achado no ACQ-07.
- **Mercúrio desligado no painel:** a fila volta vazia; as respostas que chegarem ficam só em `acq_n8n.eventos`
  (com o texto), não na conversa do painel.
- **Número desconhecido** escrevendo no WhatsApp comercial não vira lead: fica como incidente para a equipe.
- **Feriados** não são conferidos (só dia útil e horário).
- **Mensagens de mídia** (áudio, imagem) são registradas como "[audio recebido, sem texto]" e não têm resposta
  automática.
- **Limites da Meta:** número novo começa com limite diário de conversas iniciadas pela empresa e modelos de
  marketing têm limite de frequência por usuário (erro 131049 chega como status `failed` e vira incidente).
