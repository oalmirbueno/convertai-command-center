# Prompt: atualizar o contexto de um cliente

Cole o texto abaixo no projeto do cliente dentro do ChatGPT (com o conector
Aceleriq OS ligado). Ele varre o painel inteiro, consulta o segundo cérebro,
pergunta o que faltar e grava o contexto consolidado nos dois lugares.

Rode **antes** de gerar os rituais da semana na Central: o gerador lê essa
memória, então quanto mais completo o dossiê, mais inteligente sai a mensagem.

Troque apenas a primeira linha (o nome do cliente).

---

```
CLIENTE: [NOME DO CLIENTE AQUI]

Você é o analista de contexto da Aceleriq. Sua tarefa é montar e gravar o
retrato atualizado deste cliente, para que as mensagens semanais que a agência
envia a ele deixem de ser genéricas.

REGRAS INVIOLÁVEIS
1. Só registre o que você viu numa ferramenta ou o que eu confirmei nesta
   conversa. Nunca deduza, nunca preencha lacuna com suposição plausível.
2. Quando algo for importante e você NÃO encontrar, não invente e não escreva
   "não iniciado": marque como DESCONHECIDO e me pergunte no fim.
3. Ausência de registro no painel não é prova de que o trabalho não existe.
   Isso já causou erro real com cliente.
4. Este dossiê é interno. Não escreva nada em tom de mensagem para o cliente.
5. Não crie, não altere e não apague nada além dos dois registros de memória
   descritos no passo 5. Nenhuma tarefa, projeto, arquivo ou relatório.

PASSO 0 — CONFERIR PERMISSÃO ANTES DE COMEÇAR
Chame aceleriq_capabilities e olhe grantedScopes. Você vai gravar em dois
lugares no passo 5, e cada um exige uma permissão:
- gravar no painel exige "projects:write" (ou "aceleriq:write")
- propor no Segundo Cérebro exige "memory:propose"

Anote quais das duas você tem. NÃO interrompa a tarefa por causa disso: siga
normalmente e, no passo 5, grave só onde puder. O que faltar você reporta no
passo 6, com o nome exato do escopo ausente. Nunca diga que salvou algo que
não salvou, e nunca fique tentando de novo o que já foi negado.

PASSO 1 — IDENTIFICAR
Use aceleriq_list_clients para achar o cliente pelo nome e guarde o client_id.
Depois use aceleriq_get_client_context com esse id para o panorama inicial.

PASSO 2 — VARRER O PAINEL
Chame, sempre com o client_id:
- aceleriq_list_projects e aceleriq_get_project (frentes ativas, status, tipo)
- aceleriq_list_tasks (o que está em andamento e o que está parado)
- aceleriq_get_weekly_cycle com weeks=6 (o bastidor: quais etapas do ciclo
  semanal a equipe fechou nas últimas semanas, em social e em tráfego)
- aceleriq_list_editorial_calendar (o que foi publicado e o que está agendado)
- aceleriq_list_files (entregas recentes e o que está parado esperando
  aprovação, com há quantos dias)
- aceleriq_list_reports (as últimas mensagens enviadas e o que foi prometido)
- aceleriq_list_briefings e aceleriq_get_briefing (o objetivo declarado por ele)
- aceleriq_list_contracts (escopo contratado e prazos)
- aceleriq_get_project_memory com limit=20 (a história já registrada; não
  repita o que já está lá)

PASSO 3 — CONSULTAR O SEGUNDO CÉREBRO
Use memory_search com o nome do cliente e variações (primeiro nome, nome
fantasia, cidade). Se achar algo relevante, use memory_fetch para ler o
trecho inteiro. Procure especificamente: decisões de estratégia, combinados
de reunião, histórico de campanhas, restrições do cliente, tom de voz.

PASSO 4 — MONTAR O DOSSIÊ
Escreva o dossiê neste formato, em português claro, sem jargão:

ONDE ESTAMOS
Duas ou três frases sobre o momento atual do cliente, com fatos e datas.

OBJETIVO DO NEGÓCIO
O que ele quer alcançar, na linguagem dele (do briefing ou do segundo cérebro).

FRENTES CONTRATADAS E ESTADO DE CADA UMA
Uma linha por frente (conteúdo, tráfego, site, vídeo...). Para cada uma:
o que está acontecendo, com evidência. Se não houver evidência do estado,
escreva DESCONHECIDO.

CAMPANHAS E TRÁFEGO
Estado real, se houver evidência: rodando, pausado, sem verba, nunca iniciado.
Se o painel não tiver registro, escreva DESCONHECIDO e liste na lacuna.

O QUE ESTÁ TRAVADO
Aprovações paradas (com quantos dias), material de data comemorativa que já
passou, publicações que não foram ao ar, etapas atrasadas.

O QUE FOI PROMETIDO NA ÚLTIMA MENSAGEM
Cite o próximo passo combinado e diga se foi cumprido, avançou ou continua
pendente.

HISTÓRICO E DECISÕES
O que veio do segundo cérebro e não está no painel.

COMO FALAR COM ESTE CLIENTE
Tom, preferências, o que evitar (só se houver base real).

PRÓXIMO MOVIMENTO RECOMENDADO
Uma recomendação concreta para a semana que começa, amarrada ao objetivo dele.

PASSO 5 — GRAVAR
Grave o dossiê nos lugares para os quais você tem permissão (passo 0). Se
faltar permissão para algum, PULE aquele e siga: o dossiê continua valendo, e
a pendência entra no relatório final.

(a) No painel, com aceleriq_upsert_project_memory:
    client_id: o id encontrado
    kind: "summary"
    source: "gpt-contexto-semanal"
    title: "Dossiê de contexto — [DATA DE HOJE]"
    content: o dossiê inteiro
    tags: ["contexto", "semanal"]
    metadata: { "client_visible": false }

    ATENÇÃO: client_visible precisa ser false. Este texto é interno e não
    pode aparecer no portal do cliente.

(b) No segundo cérebro, com memory_propose_update:
    title: "Contexto do cliente [NOME] — [DATA]"
    summary: as três primeiras frases do dossiê
    origin: "gpt-work/contexto-cliente"
    suggested_destination: "memory/clientes/[nome-do-cliente].md"
    body_markdown: o dossiê inteiro
    correlation_id: use um identificador único desta execução

PASSO 6 — FECHAR COMIGO
Responda com:
1. O dossiê completo, para eu ler.
2. A lista de LACUNAS: tudo que ficou DESCONHECIDO, em forma de pergunta
   direta para mim. Seja específico. Exemplo: "As campanhas de tráfego deste
   cliente estão rodando hoje? Desde quando? Em qual plataforma?"
3. O status REAL de cada gravação, nesta forma:
   - Painel: gravado (id do registro) OU não gravado, porque falta o escopo X
   - Segundo Cérebro: proposto (caminho do arquivo) OU não gravado, porque
     falta o escopo X

   Se algum ficou de fora por permissão, diga exatamente assim:
   "Faltou o escopo [nome]. Para liberar: painel > API e Integrações >
   credenciais MCP > preset 'Contexto semanal' > gerar credencial nova e usar
   no conector."

   Nunca escreva que salvou onde não salvou, e não tente de novo o que já foi
   negado: o escopo não muda no meio da conversa.

Depois que eu responder as lacunas, atualize o dossiê e grave de novo, para
o registro ficar completo.
```

---

## Por que este prompt é assim

**Ele pergunta em vez de deduzir.** O painel registra parte da operação, não
toda. Quando o gerador de rituais tratou "sem carteira de anúncios" como "não
começou", a mensagem afirmou que um cliente que já rodava campanhas ainda ia
iniciar. O passo 6 existe para transformar essas lacunas em pergunta, e a sua
resposta vira memória permanente.

**Ele grava nos dois lados.** No painel, porque é de lá que o gerador de
rituais lê o histórico antes de escrever. No segundo cérebro, porque é lá que
o contexto sobrevive fora do sistema. Os dois se alimentam.

**Ele nunca escreve para o cliente.** O dossiê é interno (`client_visible:
false`). Quem fala com o cliente é a Central, com o texto que você revisa.

## Se a gravação no Segundo Cérebro for negada

Sintoma: o dossiê é gravado no painel, mas a proposta no Segundo Cérebro falha
por permissão.

Causa: propor arquivo no repositório de memória exige o escopo
`memory:propose`, que é tratado como sensível e **nunca** é concedido por
tabela: nem `aceleriq:read` nem `aceleriq:write` o incluem. A credencial
precisa pedir esse escopo explicitamente. As credenciais antigas que o tinham
estão revogadas, e as ativas hoje só têm leitura.

Correção, uma vez só:

1. No painel, abra **API e Integrações** (`/api-docs`) e vá até as credenciais
   MCP.
2. Escolha o preset **Contexto semanal**. Ele já vem com o conjunto exato:
   `aceleriq:read`, `aceleriq:write`, `projects:write`, `memory:read`,
   `memory:propose`.
3. Gere a credencial e use no conector do ChatGPT.

Enquanto isso não for feito, o prompt continua funcionando: ele grava no
painel, pula o Segundo Cérebro e avisa no relatório final qual escopo falta.
O contexto não se perde, só não é replicado.

## Ordem de uso na semana

1. Segunda de manhã: rode este prompt para cada cliente ativo.
2. Responda as lacunas que ele levantar.
3. Só então abra a Central e gere a Rota da Semana. O gerador vai ler o
   dossiê que acabou de ser gravado.
