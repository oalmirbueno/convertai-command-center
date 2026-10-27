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

Homologação final do navegador, versão do frontend e resultado dos trabalhos reais devem ser acrescentados após a verificação. O teste isolado do adaptador já gerou texto e imagem reais, mas não substitui o fluxo autenticado da carteira.
