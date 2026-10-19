# Stories na Mesa do cliente (20/10/2026)

Pedido do dono: "na mesa principal, para todos os clientes, criar uma área de stories e sequência, onde vamos
gerar stories com imagens e conteúdos, a área de destaques também, uma área de stories virais e poder agendar
stories. Bem bacana, bem intuitivo, no padrão de ícones e no padrão novo do painel". Material: o mapa mental
"Uma novela imperdível nos Stories" (MindMeister 2712335209) e o "Checklist do Instagram Viral" (Oney Araújo).

## Limite da plataforma (fato, não escolha)

A API oficial do Instagram publica story com imagem ou vídeo (`media_type=STORIES`), mas **não publica
adesivos** (enquete, caixinha de perguntas, quiz, link, contagem regressiva, localização, menção com adesivo).
Fonte: Meta, IG User Media ("publishing stickers (i.e., link, poll, location) is not supported"). Por isso todo
story tem um de dois caminhos:

- **automático**: sem adesivo; o motor do painel publica no horário (`editorial_autopublish_tick`).
- **pelo app**: com adesivo; a arte sai com a área do adesivo livre e com o roteiro exato do adesivo; no horário a
  equipe recebe o aviso "Postar agora pelo app" com a arte para baixar e o adesivo a colocar. A equipe também pode
  usar o agendador do próprio Instagram. Depois marca "Postei".

## A aba "Stories" (7ª aba da Mesa, depois de "Redes")

Ícone lucide `GalleryVerticalEnd`. Endereço `?aba=stories&bloco=`. Quatro blocos (Etapas internas, como na aba Redes):

1. **Sequência** (`bloco=sequencia`, padrão): a "novela do dia".
   - Escolhe a data, o objetivo (engajar, vender, lançar, relacionamento, bastidor) e quantos stories (3 a 8).
   - O agente (`mesa-stories`, ação `planejar_sequencia`) devolve a sequência com arco de novela:
     gancho → desenvolvimento → interação (adesivo) → valor ou prova → convite → gancho para amanhã.
   - Cada story vira um cartão 9:16 editável: molde, texto na tela (curto), adesivo, fundo, horário, caminho
     (automático ou pelo app, calculado: tem adesivo = pelo app) e destaque para onde vai depois (opcional).
   - "Gerar artes": a arte de cada story é montada na tela (canvas 1080x1920) com a foto real do acervo do
     cliente ou a cor da marca, o texto na tipografia da marca e a zona do adesivo reservada (sem nada desenhado
     por cima da foto além do texto pedido). Sobe para o bucket `mesa` e vira arquivo do cliente.
   - "Agendar a sequência": cada story vira `editorial_posts` (`content_type='story'`) e `editorial_publications`
     no horário. Automático entra como `scheduled`; pelo app fica fora do motor e recebe o aviso.
2. **Virais** (`bloco=virais`): os moldes de story viral (catálogo abaixo), com o que é, quando usar, o roteiro
   de exemplo, o adesivo e "Usar na sequência" (o agente adapta ao nicho do cliente: ação `adaptar_molde`).
3. **Destaques** (`bloco=destaques`): os destaques do cliente (`cliente_instagram_destaques`), as capas (reusa
   `GeradorDeDestaques` e `SugestaoDeDestaques` da aba Redes) e, por destaque, os stories que já foram marcados
   para ele, para a equipe salvar no destaque depois de publicado.
4. **Agenda** (`bloco=agenda`): a semana de stories, por dia e horário, com a situação de cada um:
   rascunho, arte pronta, agendado (automático), postar pelo app, publicado, falhou.

## Moldes virais (do mapa mental "Uma novela imperdível nos Stories")

| chave | nome | o que é | adesivo |
|---|---|---|---|
| me_ajude | Me ajudem nessa | pede ajuda ao público numa decisão real (qual capa, qual sabor, qual horário) | enquete |
| convite_link | Convite para o link | contexto curto e convite para clicar (produto, agenda, mentoria) | link |
| caixinha | Caixinha de perguntas | abre a caixinha; as respostas viram os stories seguintes | caixinha |
| lugares | Lugares e eventos | bastidor de evento do nicho, visita, feira, palestra | localização |
| fofoca | Fofoca do nicho | novidade ou polêmica do mercado com a opinião da marca | enquete |
| perrengue | Perrengue | um problema real do dia e como foi resolvido (humaniza) | reação |
| stories_awards | Stories Awards | premia ou destaca quem interagiu (repost de comentário, cliente do mês) | menção |
| geracao_valor | Geração de valor | dica rápida em 2 a 4 telas (utilidade pública, teoria, "você sabia") | quiz |
| ancoragem_lancamento | Ancoragem de lançamento | contagem, lembrete e prova antes de lançamento ou promoção | contagem |
| opiniao | Opinião | "compro ou não?", "concorda?": enquete de opinião sobre o tema | enquete |
| palavra_no_direct | Palavra no direct | "manda EU QUERO no direct" para conversa e venda | nenhum |

Regra da novela: cada sequência termina com um gancho para a próxima ("amanhã eu conto...") e a próxima abre
retomando. Um adesivo de interação a cada 3 ou 4 stories. Texto na tela em até 2 linhas curtas. Zona segura 9:16:
14% livres em cima e 20% embaixo (`_shared/direcao-arte.ts`).

## Servidor: função `mesa-stories` (contrato)

Corpo `{ acao, client_id, marca_id?, ... }`, JWT da equipe (`is_staff` + `can_access_client`), resposta JSON. Erros
no formato das mesas: `{ error, mensagem }` com status (409 `story_na_agenda`, 503 `sql_pendente` enquanto a
migration não está aplicada, 402 sem saldo na carteira). As ações com IA (`planejar_sequencia`, `adaptar_molde`,
`conversar`) respondem com fôlego (`respostaComFolego`). Modelo: o da Central (`modelo?`), raciocínio `low`
(padrão) ou `medium` (`raciocinio?`); nunca `max`.

- `painel` → `{ sequencias: Sequencia[], stories: (Story & { arte_url: string | null })[], destaques: Destaque[],
  moldes: Molde[], conversa: { id, mensagens } }` (sequências de 7 dias para trás a 30 à frente, da marca aberta;
  stories soltos dos últimos 30 dias). `arte_url` é a URL assinada (1 hora) da arte, para mostrar e baixar no
  "pelo app". A situação de quem está na Agenda acompanha a publicação (agendado, publicado, falhou).
  Sem a migration: `{ sql_pendente: true, aviso, ... }`.
- `planejar_sequencia { data: "YYYY-MM-DD", objetivo, quantidade (3 a 8), pedido? }` → `{ sequencia, stories,
  escolha: { versoes, escolhida, pontos, jev }, avisos: string[], custo_usd }` (gravados como rascunho, com horários
  espalhados das 09:00 às 21:00 de Brasília; hoje começa 30 minutos depois de agora). Lê o contexto completo da
  marca, o hype da semana, as regras do dono, a base do agente `stories.roteirista` e as sequências dos últimos 7
  dias (moldes, ganchos e o gancho de ontem). Duas versões em paralelo; a regra tira pontos de molde, gancho e
  frase repetidos da semana e de ritmo ruim (adesivo a cada 3 ou 4, termina com gancho) e o Jev soma novidade e
  clareza (Score); fica a de mais pontos. Repetição que sobrar vira `avisos`.
- `adaptar_molde { molde, pedido? }` → `{ story: StoryRascunho, custo_usd }` (não grava; `StoryRascunho` = campos
  editáveis do Story mais `papel` no arco).
- `salvar_story { story: Partial<Story> & { id?, sequencia_id? } }` → `{ story }`. O caminho e o roteiro do adesivo
  são sempre recalculados pelo adesivo. Mudar texto, adesivo ou fundo de um story com arte tira a arte (volta a
  rascunho). Story na Agenda (com publicação) ou publicado não muda texto, adesivo, fundo nem horário: 409.
- `apagar_story { id }` → `{ ok }` (409 se já está na Agenda ou foi publicado).
- `registrar_arte { id, file_id }` ou `{ id, caminho }` → `{ story }`. `caminho`: o PNG ou JPG que a tela subiu no
  bucket `mesa` em `<client_id>/stories/...`; a função copia para Arquivos (bucket `files`, pasta `materiais`,
  `file_type='story'`, ligado ao projeto com conta do Instagram) com o JWT de quem chamou. `file_id`: arquivo já em
  Arquivos deste cliente (imagem ou vídeo). Story rascunho vira `arte_pronta`.
- `agendar { ids: string[] }` (até 20) → `{ stories }`. Cada story volta com `situacao` e `motivo`:
  - pelo app: `situacao='postar_pelo_app'`, `aviso_em = horario - 5 min`, `roteiro_do_adesivo`; sem post na Agenda.
  - automático (só admin ou gestor): cria `editorial_posts` (`content_type='story'`, sem item de tarefa) e a
    publicação no horário por `save_editorial_post` com o JWT de quem chamou. Arte aprovada (a regra do motor:
    aprovada pela agência, travada e aprovada ou compartilhada com o cliente) entra `scheduled` com a lâmina
    congelada (`delivery_mode` automático quando a conta publica sozinha); sem aprovação entra planejada no horário
    (`situacao='arte_pronta'` e o motivo) e o promotor do banco agenda quando o cliente aprovar.
- `marcar_postado { id }` → `{ story }` (só pelo app; o automático tem a baixa do motor).
- `conversar { mensagem, conversa_id? }` → `{ resposta, bloco: "sequencia"|"virais"|"destaques"|"agenda"|"nenhum",
  conversa_id, mensagens, mensagem_id, pedido_id, aviso, custo_usd, saldo_usd }` (padrão de `mesa-instagram`:
  pedido gravado antes, núcleo das mesas, método da casa).

Tipos:

```ts
type Adesivo = { tipo: "nenhum" | "enquete" | "caixinha" | "quiz" | "link" | "contagem" | "localizacao" | "reacao" | "mencao";
  pergunta?: string; opcoes?: string[]; url?: string; texto_do_link?: string; quando?: string };
type Fundo = { tipo: "foto" | "cor"; imagem_id?: string; cor?: string };
type Story = { id; sequencia_id; client_id; ordem; molde; titulo; texto_na_tela; adesivo: Adesivo; fundo: Fundo;
  horario: string | null; caminho: "automatico" | "pelo_app"; destaque_id: string | null; file_id: string | null;
  editorial_post_id: string | null; publicacao_id: string | null;
  situacao: "rascunho" | "arte_pronta" | "agendado" | "postar_pelo_app" | "publicado" | "falhou";
  roteiro_do_adesivo: string | null; motivo: string | null; aviso_em: string | null; avisado_em: string | null;
  criado_em; atualizado_em };
type Sequencia = { id; client_id; marca_id: string | null; data; objetivo; titulo; gancho_de_amanha: string | null; criado_em };
type Molde = { chave; nome; o_que_e; quando_usar; exemplo: string[]; adesivo: Adesivo["tipo"] };
```

Quiz: a primeira opção é a certa. Enquete e quiz: até 4 opções. Link: só `https://`.

Banco (`supabase/migrations/20261020120000_stories_da_mesa.sql`): `cliente_stories_sequencias`, `cliente_stories`
(RLS: equipe com `can_access_client` lê; só a função escreve; CHECK no banco: sem adesivo = automático, com adesivo
= pelo app), cron de aviso (`stories-aviso-pelo-app`, a cada minuto: avisa a equipe do cliente no sininho, tipo
`stories_pelo_app`, 5 minutos antes do horário, uma vez por story; link `/mesa?client=<id>&aba=stories&bloco=agenda`,
o mesmo parâmetro `client` que a Mesa lê).

Motor: `editorial_autopublish_tick` publica story em **vídeo** também (`media_type=STORIES&video_url=`, arquivo com
mime `video/*` ou extensão mp4, mov, m4v, com a espera de processamento do reel). O Estúdio entrega arte
`stories_9x16` de uma lâmina como `content_type='story'` (`estudio-arte/modulos/entrega-na-agenda.ts`
`tipoDoConteudo` e `mesa_agendar_aprovados`); mais de uma lâmina 9:16 segue carrossel (o story leva uma mídia só).

## Perfil perfeito (aba Redes)

Novo bloco "Ajustes do app" no diagnóstico do perfil: os itens do checklist (sugestões de contas, rótulo de
categoria, selo do Threads, exibição do perfil, opções de contato, presentes, conteúdo de marca, publicação cruzada,
sugestões de resposta, respostas salvas, perguntas frequentes, comentários com GIF, compartilhamento e remixes,
permitir baixar reels, interações limitadas, carregar em alta qualidade, e na hora de postar: compartilhar no
Facebook, ocultar curtidas desligado, texto alternativo, marcar pessoas/colaboração, botão de mensagem, público,
tópicos (3), renomear áudio, localização, lembrete, modelo, legendas automáticas). Cada item: o que fazer, onde
fica no app (caminho), por quê, e a recomendação **adaptada ao tipo de negócio** (o checklist original é de criador
de conteúdo; negócio local mantém WhatsApp e localização, loja usa perguntas frequentes etc.). A API não lê esses
ajustes: é checklist marcado pela equipe, guardado por cliente.
