---
name: loja-virtual
description: Como construir as seções de uma loja virtual com os componentes da casa (vitrine por categoria, página do produto, carrinho e checkout por link de pagamento ou WhatsApp) sem inventar produto nem preço. Use quando o pedido da passada disser "LOJA VIRTUAL" ou o pacote tiver o campo loja.
---

# Loja virtual

A loja inteira já existe na casca (`src/lib/loja.tsx`): produtos, preços, categorias, carrinho, checkout e a compra na volta do pagamento. Você monta as seções em volta dela, com a marca do cliente.

## O que vem do pacote
- `pacote.loja.checkout`: "whatsapp" (o carrinho vira uma mensagem com itens e total) ou "link" (cada produto leva ao link de pagamento do gateway do cliente).
- `pacote.loja.produtos`: id, nome, preço (null = sob consulta), categoria, descrição, link de pagamento, disponível.
- `pacote.loja.categorias`: na ordem.

## Componentes (use, não refaça)
- `<Vitrine limite? imagemDoProduto? />`: filtro por categoria e a grade. Na página inicial, `limite={6}` para os destaques; na página `produtos`, sem limite.
- `<CartaoDoProduto produto imagem />` e `<BotaoComprar produto rotulo? />` quando a seção pede um layout próprio (hero com o produto em destaque, chamada final).
- `produtosDaLoja(categoria)`, `categoriasDaLoja()`, `precoDoProduto(p)`, `linkDoProduto(p)`.
- A página do produto abre por `linkDoProduto(p)` (`#produto-<id>`) por cima da vitrine e conta ViewContent. O carrinho flutuante, o checkout e o Purchase na página `/obrigado/` também já estão na casca.

## Seções
1. **Hero dividido:** a promessa da loja e um produto em destaque com foto real de `public/` e o `BotaoComprar`.
2. **Vitrine:** `<Vitrine />` com o título da copy. Foto do produto só de `public/imagens/` (ligue pelo nome ou pela seção em `imagemDoProduto`); sem foto, o cartão fica só com texto.
3. **Diferenciais e prova:** entrega, troca, pagamento e garantia só se estiverem no pacote.
4. **Perguntas:** frete, prazo, troca, pagamento e segurança, com as respostas do pacote.
5. **Obrigado (página `obrigado`):** confirma o pedido, diz os próximos passos e mostra o WhatsApp. Ela fica fora do menu (`paginasDoMenu()`).

## Nunca
- produto, preço, desconto, frete grátis ou parcelamento que não estejam no pacote;
- outro carrinho, outro checkout, formulário de cartão ou chave Pix escrita na página;
- `fbq`, `gtag` ou script de rastreio (a casca conta AddToCart, InitiateCheckout e Purchase depois do Aceitar dos cookies).
