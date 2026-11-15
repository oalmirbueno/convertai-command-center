# Leitura diária dos grupos de clientes

Pedido do Almir em 09/11/2026. Decisões dele: os 12 grupos entram no piloto; o sistema atualiza dossiê e cria
tarefa interna sozinho, e tudo que fala com cliente ou muda post passa por ele; aviso aos clientes por cláusula
no contrato; transcrição no próprio servidor, áudio apagado em 7 dias; leitura sem atrapalhar o comercial.

## Mapa

```
Grupos do WhatsApp (12)
   │  segundo aparelho conectado do número da equipe, SÓ LEITURA
   ▼
Leitor no servidor do Hermes  (este diretório → /opt/aceleriq-leitor-grupos)
   • só decifra os 12 grupos da lista; particular e outros grupos nem são abertos
   • áudio → texto com Whisper local (áudio some em 7 dias)
   • guarda o dia em arquivo e uma fila em disco; repete a entrega até o n8n confirmar
   ▼
n8n "Clientes: leitura das conversas dos grupos"  (webhook acq04-mensagens)
   • grava cada mensagem uma única vez (chave = id da mensagem)
   • Jev classifica: pedido, decisão, resposta, correção, informação ou ruído; autorização e dinheiro vão para pessoa
   ▼
Banco acq_n8n (mensagens, eventos, propostas)
   ▼  ETAPA 2 (depois da primeira rodada real)
Resumo do dia por cliente → dossiê e cérebro do cliente no painel (o do dia substitui, não soma)
   → tarefa interna → segundo cérebro → sugestões ao Almir → rituais da semana sem repetir assunto
```

## Imagem, vídeo e documento (11/11/2026)

```
Imagem, vídeo ou documento no grupo
   ▼
Leitor: o texto da mensagem segue na hora, como sempre. Depois baixa o arquivo (imagem e documento até 20 MB,
        vídeo até 64 MB), reduz a imagem, tira até 6 quadros do vídeo e transcreve a fala do vídeo aqui (Whisper)
   ▼
n8n "Clientes: entender imagens e vídeos dos grupos" (webhook acq12-midia, mesmo segredo do leitor)
   • um modelo de visão DESCREVE o que se vê e copia os textos visíveis (preço, data, nome); não interpreta
   • a descrição fica na mensagem; o resumo do dia passa a ler; mídia descrita nunca é tratada como ruído
   • responde ao leitor se o arquivo é material do cliente (quem mandou foi o cliente)
   ▼
Material do cliente fica no servidor com uma ficha; o resto é apagado na hora
   ▼
Clio (Hermes), rotina a cada 20 min, sem gastar modelo: sobe o arquivo para o painel, pasta Materiais do projeto
do cliente, etiqueta `grupo-whatsapp`, com a descrição; avisa o n8n do id do arquivo e apaga a cópia do servidor
```

O arquivo original nunca vai para o modelo: só a imagem reduzida ou os quadros. O que a própria agência manda no grupo
é descrito (entra no resumo), mas não vira arquivo do cliente. Documento (PDF, planilha) é guardado, não interpretado.
Prova sem tocar em cliente: `python3 prova_midia.py` no servidor (depois apagar a linha `TESTE-MIDIA-*` no banco).

A ponte do comercial (`mercurio-pilot-bridge`) não é alterada nem reiniciada. O leitor roda com usuário próprio,
teto de CPU e memória, e não tem nenhuma função de envio (o teste confere).

## Instalar (o Almir roda; o modo automático do Claude não escreve no servidor)

1. Copiar e preparar (não conecta nada ainda):
   `scp -r C:\AI\lf-N8N\automacoes\n8n\servidor\leitor-grupos root@ssh.aceleriq.com.br:/root/`
   `ssh root@ssh.aceleriq.com.br "bash /root/leitor-grupos/instalar.sh preparar"`
2. No n8n, criar a credencial "ACQ Webhook mensagens (segredo)" (Header Auth, nome `x-acq-segredo`, valor = um
   segredo novo de 32+ caracteres), escolher essa credencial no nó "Mensagem recebida" e publicar o fluxo.
3. Gravar o mesmo segredo no servidor: `ssh -t root@ssh.aceleriq.com.br "bash /root/leitor-grupos/instalar.sh segredo"`
4. Conectar o aparelho: `ssh -t root@ssh.aceleriq.com.br "bash /root/leitor-grupos/instalar.sh parear 55DDDNUMERO"`
   e digitar o código no celular do número da equipe (Aparelhos conectados → Conectar com número de telefone).
5. Ligar: `ssh root@ssh.aceleriq.com.br "bash /root/leitor-grupos/instalar.sh ligar"`

Conferir a qualquer hora: `instalar.sh estado`. Parar: `instalar.sh desligar`.

## Regras

- Grupo novo: entra primeiro em `/etc/mercurio-pilot/allowed-groups.json` (com `client_id`), depois
  `instalar.sh preparar` de novo (atualiza a cópia da lista) e uma linha em `acq_n8n.grupos_cliente`.
- O leitor usa o Baileys da pasta do Hermes (mesmo link da ponte). Se uma atualização do Hermes trocar essa
  pasta, os dois param juntos: conferir com `instalar.sh estado`.
- Nada de chave neste repositório: o segredo do webhook fica só em `/etc/aceleriq-leitor-grupos/webhook.segredo`.
