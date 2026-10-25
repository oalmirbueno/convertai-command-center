---
name: pixel-e-eventos
description: Como deixar o pixel da Meta e os eventos padrão certos no site (PageView, ViewContent, Lead, Contact, Schedule, AddToCart, InitiateCheckout, Purchase) sem escrever código de rastreio, só com os componentes e atributos da casa e respeitando a LGPD. Use em toda passada que tiver "MEDIÇÃO" no pedido.
---

# Pixel e eventos

O rastreio é da casca (`src/lib/integracoes.tsx` e `src/lib/loja.tsx`). Ela carrega o pixel só depois do Aceitar do aviso de cookies, dispara os eventos padrão da Meta com o eventID que a Conversions API do servidor repete (a Meta deduplica) e desliga os eventos automáticos da Meta quando a equipe não ligou (assim nada conta em dobro). Seu trabalho é só ligar os botões certos.

## Quem conta o quê
- **PageView:** toda página, sozinho.
- **Lead:** o `<Formulario />` ao enviar (com correspondência avançada; o pixel faz o hash).
- **Contact:** todo link de WhatsApp (`linkDoWhatsapp`), `tel:` e `mailto:`, sozinho.
- **Schedule:** o botão de agendar ou pedir orçamento leva `data-evento="Schedule"`.
- **ViewContent:** abrir um serviço ou ver detalhes leva `data-evento="ViewContent" data-evento-nome="<nome>"`; na loja, a página do produto conta sozinha.
- **CompleteRegistration:** o botão que conclui a inscrição leva `data-evento="CompleteRegistration"`.
- **AddToCart, InitiateCheckout e Purchase:** só pelos componentes de `src/lib/loja.tsx`.

## Regras
- Nunca escreva `fbq`, `gtag`, `<script>` de rastreio, `<img>` de pixel ou `noscript` do pixel: sem consentimento nada pode sair (LGPD).
- Use `pacote.medicao.eventos` para saber o que o site mede; evento fora da lista a casca não manda.
- Precisa disparar por código (raro): `rastrear(evento, dados)` de `src/lib/integracoes.tsx`, com `value` e `currency` quando houver valor.
- O rodapé tem o botão "Preferências de cookies" (`abrirPreferenciasDeCookies()`) quando `pacote.integracoes.cookies` existe.
