# Mesa do cliente, versão 5: organização (23/09/2026, noite)

Contratos do servidor para a rodada de organização pedida pelo dono. As telas chamam como nas versões anteriores (`chamarFuncao` de `src/lib/mesa/api.ts`).

## Ditado (microfone grátis)
`src/components/mesa/Ditado.tsx`: `<Ditado valor={texto} onChange={setTexto} disabled? />`. Reconhecimento de voz do navegador (pt-BR), escreve no campo em tempo real, sem custo. Some onde o navegador não tem. Todo campo de conversa com agente usa, ao lado do botão Enviar.

## Referências em destaque
`cliente_referencias.destaque boolean` (padrão false). A equipe marca e desmarca direto pelo banco (update, a RLS já permite). O diretor de arte usa as em destaque sempre, antes das outras.

Papéis (`cliente_referencias.papel`), hoje 43 e 78 no banco:
- `identidade` (origem `arquivo`): artes JÁ APROVADAS da própria marca. Mostram o estilo que a marca já usa; o diretor mantém esse estilo. Na tela: "Artes da marca".
- `tecnica` (origem `workspace`, Pinterest, link): referências de fora. Mostram uma composição, tipografia ou técnica para copiar, aplicando as cores e a identidade da marca. Na tela: "Referências de composição".

## Estúdio: fotos da lâmina (foto real composta)
`estudio-arte` `configurar { trabalho_id, card: { ordem, fotos_livres: [{ caminho, papel, nota? }] } }`
- `caminho`: arquivo no bucket `mesa` em `<client_id>/estudio/fotos/<uuid>.<ext>` (a tela sobe direto pelo Storage, como os anexos do agente do mês; colar com Ctrl+V, arrastar ou escolher do acervo/arquivos).
- `papel`: `fundo` (a foto é o fundo da lâmina, fica como está, o texto e o design vêm por cima) ou `elemento` (pessoa, rosto ou objeto real que entra na composição exatamente como é).
- Até 1 fundo e 2 elementos por lâmina; `[]` limpa. `nota` (até 200 caracteres): como usar ("rosto dela à direita, olhando para o texto").
- A lâmina volta com `fotos_livres` gravadas em `direcao.cards[].fotos_livres`; o `gerar_card` seguinte usa.

## Estúdio: referências escolhidas pela equipe
Quando a lâmina ou o conjunto tem `referencias_ids` escolhidas na tela, o gerador segue essas referências de perto (layout, composição, hierarquia e tratamento), aplicando a identidade visual da marca e uma diferenciação leve. Sem mudança de contrato.

## Campanhas: conversa com o agente
`agente-calendario` `campanha_conversar { campanha_id, mensagem, anexos?: string[] }` → `{ campanha, proposta, resposta, conversa_id, custo_usd }`.
O estrategista aplica o pedido na campanha (nome, objetivo, conceito, identidade) e/ou nos conteúdos (proposta ligada): muda, acrescenta ou tira conteúdos. Histórico em `agente_conversas` com `referencia_tipo = 'mesa_campanha'` e `referencia_id = campanha.id`; mensagens em `agente_mensagens` (leitura direta pela RLS da equipe).
