# Proposta de créditos do Aceleriq de Bolso

27/10/2026. Proposta para revisão de Almir. Não publicada, não aprovada e sem checkout.

Decisão já confirmada: acesso anual por R$ 97 com pacote inicial de créditos, seguido de recargas avulsas. Parcelamento fica para a integração de pagamentos, sem quantidade ou juros definidos nesta etapa.

## Condições sugeridas

| Item | Preço | Créditos | Provisão planejada para IA |
| --- | ---: | ---: | ---: |
| Acesso anual | R$ 97 | 100 iniciais, sem renovação mensal | R$ 14 |
| Recarga Essencial | R$ 19 | 50 | R$ 7 |
| Recarga Impulso | R$ 49 | 150 | R$ 21 |
| Recarga Escala | R$ 97 | 350 | R$ 49 |

Sugestão de consumo: 1 crédito por geração de texto e 5 por geração de imagem. Edição manual, consulta e download não consomem créditos. Pacotes podem ser combinados. Recarga não renova acesso; antes de qualquer venda, sua validade será congelada no pedido e não poderá ultrapassar o acesso vigente.

A política de 12 créditos existente no banco é de homologação privada; não é substituída automaticamente por esta proposta. O catálogo nasce vazio. Os cartões com os três pacotes na prévia local são fixtures rotuladas para avaliação visual, não ofertas reais publicadas.

## Base do planejamento

Uma chamada real de texto com openai/gpt-4.1-mini retornou usage.cost de US$ 0,000681. Uma imagem quadrada 1K com google/gemini-3.1-flash-image retornou US$ 0,067599. As duas respostas foram recebidas e validadas pelo adaptador local do Bolso; não foram uma transação da carteira de produção.

A proposta usa provisão de R$ 0,14 por crédito. Em um cenário de dólar a R$ 7 (hipótese de planejamento, não cotação), 5 créditos oferecem R$ 0,70 de provisão para uma imagem cujo custo observado seria cerca de R$ 0,47. Um único teste não mede custo máximo, qualidade consistente ou rentabilidade. Modelos, volume de tokens, câmbio, falhas e taxas podem mudar o custo.

O restante de cada venda é anterior a impostos, taxas de pagamento, operação e suporte. Não deve aparecer como lucro líquido. A provisão nesta etapa é configuração de oferta; nenhum dinheiro foi separado, transferido ou carregado no OpenRouter. Na integração de pagamentos, a ordem verificada deverá registrar essa provisão de forma idempotente, separadamente do crédito comercial do usuário.

## Antes de publicar

Aprovar quantidade inicial, preços e créditos das recargas, tarifas e provisões. Aplicar somente a migração incremental revisada com autorização explícita, conforme AGENTS.md e BOLSO-RECARGAS-PLANO.md. Configurar o OpenRouter no servidor e homologar o fluxo autenticado. Manter pagamentos desligados até implementar pedido congelado, validação de assinatura/valor e concessão idempotente.
