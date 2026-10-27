# Publicação do Bolso em 27/10/2026

Almir autorizou aplicar o incremento e publicar PR 102 com OpenRouter e pagamentos desligados. Também aprovou os preços, créditos iniciais e recargas descritos na proposta comercial. Nenhuma cobrança foi habilitada.

## Banco e motor

Preflight no projeto existente: zero lotes negativos, titulares inconsistentes, trabalhos inconsistentes, reservas incoerentes e reservas de trabalhos encerrados. Nenhum pedido na fila, processando ou incerto. As 39 funções reais do baseline corresponderam ao baseline local depois de normalizar somente espaços; não havia alterações desconhecidas a sobrepor.

Admissão pausada durante a aplicação. Somente `20261027220000_bolso_carteiras_recargas_openrouter.sql` foi aplicado pelo conector Supabase, que registrou a versão remota **20261027173334**, nome `bolso_carteiras_recargas_openrouter`, em uma statement. Hash remoto das statements unidas por chr(30): `4185d4a91183fb819e6bbd03c6b13997fafd3b36e792f4604d9fe3227f1c999f`. O timestamp remoto é diferente do nome local; este recibo não declara reaplicação ou registro do baseline original. Não executar replay ou db push geral para tentar igualar os nomes.

Verificação posterior: RLS habilitado no catálogo, catálogo inicialmente vazio, índices de reserva por trabalho/lote presentes, constraint aceita OpenRouter, pagamentos false. A admissão foi restaurada. O limite de homologação foi ampliado de 2 para 4 pedidos diários por pessoa e no total para comportar um texto e uma imagem adicionais; os dois erros OpenAI anteriores continuam no histórico.

Edge `bolso` versão 7 ACTIVE, JWT verificado. Hash do bundle: `914b56e1e7aaf257e14e7d66f667e3c6eaff14370c9a7d90cb8631b120ebf7fc`. Somente esta função foi publicada. Modelos: `openai/gpt-4.1-mini` e `google/gemini-3.1-flash-image`. Reutilização explícita da chave operacional OpenRouter já existente no servidor, sem rotação nem exposição ao cliente. Credenciais não constam deste recibo.

## CI e evidência

No head `41aaa848`, CI geral teve 11.531 testes aprovados, seis falhas e um skip. Cinco falhas são anteriores ao lote e seus testes e arquivos-alvo são byte a byte idênticos ao main `945a9855`: contrato de ajuste do Estúdio, contrato de ação interna do calendário, data fixa no catálogo de vídeo, CSS min() na BancadaDaPauta e texto com dupla codificação em migration de cobrança. Não foram ocultadas, nem foi reescrita migration congelada.

A sexta falha era de padrão visual introduzido nesta frente e foi corrigida sem ampliar tetos: textos curtos, ajuda contextual e componentes/tokens do sistema. Catraca 16/16, estúdio 23/23, administração 10/10 e recargas 7/7 passaram.

## Homologação autenticada e publicação concluídas

PR 102 integrado ao main em `ed213451cc314a3dc36c64426ecf21f36a3d54e8`. Frontend publicado em `https://aceleriq.online` e conferido pelo `version.json`: build `mvqz57g6-o2tsxj`, revisão do merge, deployment Cloudflare `e646b20b-200d-4b43-8015-463d09b14a6f`. O build passou. O recibo não afirma que o CI geral ficou verde: permanecem as cinco falhas de baseline descritas acima.

O fluxo autenticado da conta do proprietário concluiu pelo OpenRouter:

| Pedido | Resultado | Créditos | Custo informado pelo fornecedor |
| --- | --- | ---: | ---: |
| Texto | Concluído, mensagem disponível para edição | 1 | US$ 0,000641 |
| Imagem | Concluída em 1024 × 1024, inspecionada e baixada pelo botão do painel | 5 | US$ 0,067605 |

Total observado: US$ 0,068246. A edição manual da direção da arte não consumiu créditos. O extrato passou de 12 para 11 e depois 6; nenhuma reserva ficou pendente. Os erros OpenAI anteriores foram devolvidos e permanecem no histórico. O teste comprova geração, armazenamento, download e contabilização; não comprova conversão publicitária nem custo máximo de todas as gerações.

Após o teste, a política comercial V2 foi criada e aprovada pelo fluxo administrativo com 100 créditos iniciais, 12 meses, texto 1, imagem 5 e formatos quadrado, retrato e Stories. O acesso foi concedido exclusivamente à conta autenticada do proprietário pelo botão “Usar minha conta” e confirmado no banco e na interface. Saldo final: **106 créditos**, somando 100 comerciais e 6 remanescentes da validação privada; zero reservado. Validade do novo acesso: 27/10/2027. Nenhum saldo anterior foi apagado.

As três ofertas foram salvas, conferidas e publicadas no catálogo da V2: Essencial 50/R$ 19, Impulso 150/R$ 49 e Escala 350/R$ 97, com validade de 365 dias. Provisões internas de R$ 7, R$ 21 e R$ 49 são planejamento, não transferência de dinheiro nem lucro líquido. Recargas não renovam o acesso.

Estado final conferido: pagamentos false; exposição geral do estúdio false; geração real true; demonstração false; pausa false. Limite privado final de 1 pedido simultâneo e 10 diários por pessoa e no total, para que os quatro pedidos de homologação não bloqueiem o uso da conta. Não é a definição de capacidade para um lançamento público. Nenhuma compra, recarga financeira ou campanha de mídia foi ativada.

## Ajuste adicional identificado no navegador

Após a imagem ser entregue, o painel ainda mostrava o aviso de uma falha anterior do mesmo tipo. A correção considera somente o pedido mais recente de texto e de imagem; falhas atuais do outro tipo continuam visíveis. Revisão independente sem achados bloqueantes, 33/33 testes do estúdio aprovados, incluindo sete regressões novas. Este ajuste pertence ao PR complementar e não está incluído na revisão publicada acima até que seu merge/publicação sejam registrados.
