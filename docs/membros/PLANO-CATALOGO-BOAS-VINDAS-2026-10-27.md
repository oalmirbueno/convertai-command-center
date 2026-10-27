# Catálogo e boas-vindas reais

Preflight para o catálogo existente. **Nenhuma alteração cadastral aplicada.** Pagamentos permanecem desligados. Não há mudança de schema, RLS, políticas de licença, saldo, prazo ou concessão.

Na conferência autenticada de 27/10, o produto de teste apareceu publicado e com **Produto gratuito desmarcado**. Portanto, a hipótese inicial de reaproveitar um cadastro gratuito não foi confirmada. O SQL anexo contém somente leituras: não converter esse produto em gratuito nem arquivar materiais sem revisar seus identificadores e direitos. O guia gratuito já funciona na interface, independentemente desse cadastro.

## Resultado proposto

- Conferir o cadastro `Boas-vindas à biblioteca: Produto de teste`, categoria `Teste`, e seus materiais antes de propor limpeza cadastral.
- Preservar suas relações e direitos existentes. A seleção visual já oculta esse produto da vitrine.
- Publicar um guia textual real de quatro passos. Não anunciar vídeo, curso, PDF ou aula que não exista.
- Arquivar somente os materiais de demonstração cujos UUIDs forem revisados no preflight. Manter arquivos armazenados e registros de progresso para rollback.
- Manter Orçamento em Movimento e CRM Aceleriq, suas capas próprias e licenças atuais. Produtos pagos continuam mostrando a oferta correspondente para quem não possui acesso.
- UGC permanece um cartão informativo `Em breve`, sem venda, link de checkout ou acesso funcional.

## Frontend já preparado

O guia de boas-vindas existe na própria interface, portanto funciona antes deste ajuste de catálogo. A vitrine não expõe itens da categoria exata `Teste` nem títulos contendo `Produto de teste`. Essa seleção visual não concede nem revoga acesso. Links legados continuam obedecendo às regras do servidor.

As capas cadastradas em HTTPS prevalecem. Na ausência delas, o frontend utiliza as novas imagens locais conforme o assunto do produto. Nenhuma URL de checkout é criada pelo frontend.

## Ordem de aplicação

1. Revisar o PR e publicar o frontend com as capas.
2. Executar somente o preflight de `PLANO-CATALOGO-BOAS-VINDAS-2026-10-27.sql`.
3. Conferir o único produto selecionado, os materiais e os direitos atuais. Registrar snapshot das linhas selecionadas sem dados pessoais.
4. Preparar um incremento separado com UUIDs revisados e obter aprovação para aplicá-lo. Nenhum bloco de alteração está incluído neste preflight.
5. Conferir com uma conta de membro: boas-vindas abertas, materiais de teste ausentes, CRM e Orçamento abrindo oferta ou conteúdo conforme direito existente. Conferir também a conta administrativa.

## Invariantes e rollback

- `membros_acessos`, `membros_compras`, `membros_ferramentas_licencas`, direitos do Bolso, carteiras e configurações de pagamentos não são alterados.
- Nenhum produto é excluído. Não converter os produtos pagos em gratuitos.
- O preflight é somente leitura. Uma futura alteração deve exigir UUIDs revisados e conferir o estado atual antes de executar.
- Não usar busca genérica por palavra para arquivar conteúdo.
- Rollback lógico: restaurar campos do produto e estados dos materiais a partir do snapshot; arquivar o novo material textual. Não excluir progresso, arquivos ou relações.
- Caso o preflight revele outro cadastro gratuito real, revisar a regra comercial separadamente. Não retirar acesso adquirido ou concedido para satisfazer uma aparência de bloqueio.

## Conteúdo das boas-vindas

O texto integral está no componente `VitrineDoMembro`. Orienta a pessoa a explorar o catálogo, abrir o que já é seu, preparar uma campanha e revisar antes de publicar. Explica que ferramenta e material têm direitos independentes e que o consumo aparece antes da geração. Não promete resultado de vendas nem liberação de funções futuras.
