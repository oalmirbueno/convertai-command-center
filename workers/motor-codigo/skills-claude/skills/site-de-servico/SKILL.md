---
name: site-de-servico
description: Como construir as seções de um site de serviço que converte (serviços, prova, processo, área de atendimento, orçamento pelo WhatsApp, agendamento e perguntas). Use quando o pedido da passada disser "SITE DE SERVIÇO" ou o objetivo do pacote for Site de serviço.
---

# Site de serviço

Quem chega num site de serviço quer saber três coisas em segundos: o que você faz, se resolve o caso dele e como pedir. Cada seção responde uma delas e termina num próximo passo.

## Mapa que converte (a ordem do pacote manda)
1. **Abertura (hero):** o serviço e o resultado para quem, com a cidade quando o negócio é local. Dois botões: pedir orçamento (WhatsApp, `linkDoWhatsapp("Olá! Quero um orçamento de ...")`) e agendar (`data-evento="Schedule"`).
2. **Serviços:** de 3 a 6, cada um com o resultado em uma frase, o que inclui e o botão de orçamento daquele serviço (a mensagem do WhatsApp leva o nome do serviço). Abrir ou expandir um serviço leva `data-evento="ViewContent" data-evento-nome="<serviço>"`.
3. **Prova:** só dado real do pacote (anos de casa, garantia, certificações, fotos reais do trabalho, depoimentos que vieram). Sem dado, mostre o método. Use a skill prova-honesta.
4. **Processo:** do primeiro contato à entrega, em 3 a 5 passos. Prazo só se estiver no pacote.
5. **Área de atendimento:** bairros ou cidades do pacote (`contexto_do_cliente.endereco`, `marca`); com endereço, o `<Mapa />`. Nada de cidade inventada.
6. **Perguntas (faq):** preço, prazo, garantia, área atendida e forma de pagamento, com as respostas do pacote; sem resposta no pacote, a pergunta sai.
7. **Chamada final e contato:** orçamento sem compromisso pelo WhatsApp, o `<Formulario />` (conta Lead) e o botão de agendar.

## Botões e medição
- Todo CTA de orçamento é link de WhatsApp (`linkDoWhatsapp`) ou o formulário: os dois já contam Contact e Lead pela casca.
- Agendar: link ou botão com `data-evento="Schedule"` (se o pacote tiver link de agenda, use; senão, o WhatsApp com "Quero agendar").
- Nunca escreva `fbq`, `gtag` ou script de rastreio: a casca dispara depois do Aceitar dos cookies.

## Preço
- Preço só se estiver no pacote. Sem preço: "sob consulta" com o botão de orçamento ao lado.
