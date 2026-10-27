# Complemento ao trabalho do Claude e da equipe

Data: 27/10/2026. Produto: Aceleriq de Bolso. Pagamentos permanecem desligados.

## Ponto de partida preservado

A landing parte do arquivo revisado em 27/10 às 09:54, mantendo a headline **“Seu post é bonito. Então por que ninguém compra?”**, a narrativa e o mecanismo **“Primeiro a venda. Depois a frase. Por último, a arte.”**. Não houve substituição da copy por uma nova campanha.

O motor e o painel partem do PR103 integrado, commit `a381fb151918ae3e97a58e51c5006e2824836a9b`. O PR102 já havia implantado OpenRouter, carteira individual, reserva de saldo e recargas. Esta entrega complementa essa base; não substitui o Mesa Ads nem mistura a carteira do cliente com a da agência.

## O que mudou na landing

- Hero mais amplo, pessoa recortada integrada ao fundo, peças originais ao redor e trilha visual oferta → mensagem → arte.
- Comparação visual entre uma arte isolada e uma campanha orientada por uma oferta. A comparação não apresenta métricas de vendas nem promete resultados.
- Demonstração fictícia substituída por quatro imagens reais: cadastro da marca, escolha do objetivo, edição do texto e uma arte gerada no Bolso. As telas representam a prévia desta evolução, e a arte é resultado de geração real já concluída anteriormente.
- Três novos posters originais, somados aos seis já existentes. Galeria horizontal, ampliação, navegação por teclado e peças sem corte.
- Oferta alinhada às condições aprovadas: R$ 97/ano, 100 créditos iniciais, 1 por texto e 5 por imagem, com recargas avulsas. Os R$ 8,08 continuam sendo equivalência mensal do valor anual, não parcela prometida.
- Barra de oferta no mobile, oculta junto ao hero e à própria oferta para evitar duplicação; respeita área segura e movimento reduzido.
- Copy, estudos e garantia escritos pelo Claude preservados. A garantia de 7 dias está na base editorial; operação de reembolso/checkout ainda precisa acompanhar a implantação comercial.

## O que muda na experiência do membro

1. **Entrada:** boas-vindas com um guia real de uso. Nenhum vídeo fictício apresentado como aula pronta.
2. **Vitrine:** produtos do catálogo e licenças reais. O cadeado representa acesso, não uma simulação de bloqueio para quem já comprou.
3. **Campanha:** quatro etapas curtas, objetivo → produto → oferta → revisão. A escolha do CTA acompanha o contexto da campanha.
4. **Texto:** mensagem, legenda, chamada e direção visual editáveis. Copiar, editar manualmente e baixar não consome créditos.
5. **Arte:** formato, versão do texto, custo e ação próximos. Resultado em área própria, ampliador em tela grande e preservação das versões anteriores.
6. **Créditos:** saldo individual e confirmação do custo antes de cada solicitação. Falhas e reservas seguem o controle já existente.

No desktop, o cabeçalho e a navegação ficam estáveis, enquanto a área de trabalho rola. O menu tem controle explícito junto ao conteúdo, largura consistente e comportamento real de expansão no tablet. O mobile conserva controles utilizáveis e leitura sem transbordamento.

## Motor criativo preparado

- **Sol 6.1** (`openai/gpt-6.1-sol`): organiza uma ideia em proposta de briefing. O usuário aplica e salva explicitamente; a IA não sobrescreve a campanha em silêncio.
- **Terra 6.1** (`openai/gpt-6.1-terra`): copy e legenda em português natural, com fatos da oferta e uma chamada clara. Sem fallback oculto para outro modelo.
- **Imagens:** mantém o modelo de imagem contratado. Referências e fotos do próprio usuário são privadas e limitadas por campanha. Um ajuste cria uma nova imagem e preserva a original.
- **Cobrança:** preparação por IA e copy usam 1 crédito por solicitação; nova imagem e ajuste usam 5. São ações distintas e o custo é informado antes da confirmação. Upload de referência não é uma geração.
- **UGC:** somente “Em breve”. Não gera vídeos, não vende acesso e não consome saldo.

Esses novos recursos de servidor dependem da migration incremental, implantação da função e ativação controlada da flag. A prévia visual funciona com a API atual; nenhum teste local equivale a afirmar que os novos modelos já foram ativados na conta de produção.

## Funil proposto, complementando o que já existe

**Criativo → landing → acesso anual → primeira campanha → recarga → produtos complementares → serviços da agência.**

| Etapa | Conteúdo e ação | Sinal a observar |
|---|---|---|
| Atenção | Poster “Campanha primeiro. Pixels depois.” apresenta o mecanismo | Clique qualificado e visita à seção do método |
| Comparação | Poster “Bonito não basta.” mostra a diferença de abordagem | Interesse na demonstração real |
| Oferta | Poster “Pare o scroll. Comece uma conversa.” apresenta R$ 97/ano | Visualização da oferta e início de compra, quando habilitado |
| Convencimento | Copy do Claude + comparação + peças + produto real + condições | Avanço até oferta e dúvidas recorrentes |
| Ativação | Guia gratuito → marca → objetivo → oferta → texto → arte | Primeira campanha concluída, sem impor gasto extra |
| Uso recorrente | Histórico, versões, referências próprias, legenda e ajustes | Retorno ao estúdio e custo real por geração |
| Recarga | 50/R$ 19, 150/R$ 49, 350/R$ 97 | Consumo, margem de contribuição e recompra após ativar pagamentos |
| Próximo passo | Orçamento em Movimento e CRM, conforme necessidade e licença | Interesse no produto e uso, sem desbloqueio automático |
| Serviço | Planos recorrentes/contato da agência quando destino oficial estiver cadastrado | Pedido de conversa com a equipe |
| Futuro | UGC identificado como “Em breve” | Interesse, sem promessa de entrega ou data inventada |

As três peças são hipóteses de teste, não anúncios com conversão comprovada. Usar UTMs sem dados pessoais para distinguir conceito e posicionamento. Primeiro medir a geração de campanhas e custo por conta; só depois ampliar mídia. Não disparar anúncios nem instalar pixels com esta entrega.

## Pacote visual

| Arquivo | Uso |
|---|---|
|01-campanha-primeiro|Poster de mecanismo, 4:5|
|02-bonito-nao-basta|Poster comparativo, 4:5|
|03-pare-o-scroll|Poster de atenção e preço, 4:5|
|04-capa-estudio|Aceleriq de Bolso|
|05-capa-relacionamento|CRM|
|06-capa-comunicacao|Comunicação e Orçamento|
|07-capa-ugc|Antecipação UGC, somente em breve|

Originais PNG ficam no pacote local. O painel usa WebP com a composição preservada. Capas cadastradas pelo administrador continuam tendo prioridade. As artes conceituais geradas por IA são diferentes das capturas reais do produto e não representam resultados comerciais medidos.

## Entrega para revisão

- [Landing privada no Sites](https://aceleriq-de-bolso-previa-20261026.oalmirbueno.chatgpt.site), no projeto existente e restrita à conta proprietária. Pode exigir login no ChatGPT.
- [PR 104](https://github.com/oalmirbueno/convertai-command-center/pull/104), com painel, motor, migration incremental e snapshot da landing em `marketing/aceleriq-de-bolso`.
- Prévia local autenticada em `http://127.0.0.1:4187/membros`.
- Pacotes locais `landing-aceleriq-refinada.zip` e `criativos-e-capas-aceleriq.zip`, com este complemento incluído.

A publicação privada da landing foi concluída. A versão de produção do painel permanece na entrega anterior; esta evolução ainda depende da revisão e autorização do PR 104. O teste visual não consumiu créditos nem criou campanhas definitivas na conta.

## Implantação e pontos ainda dependentes de autorização

1. Revisar o draft PR, evidências, testes e plano incremental do motor.
2. Autorizar a migration nova e publicar frontend/função, mantendo pagamentos desligados. Não executar `db push` nem repetir migrations anteriores.
3. Ativar recursos criativos após verificações de saldo, isolamento e idempotência. Fazer smoke real de briefing, copy, referência e ajuste com a conta autorizada e reconciliar os créditos.
4. A limpeza cadastral de boas-vindas tem plano próprio. Exige leitura dos UUIDs reais dos materiais de demonstração antes de arquivar; não remove direitos, histórico ou arquivos definitivamente.
5. Checkout, gateway, parcelamento efetivo, reembolso, integração de compra, domínio público da landing e mídia continuam sendo etapas comerciais separadas.

Este documento é um complemento pronto para revisão da equipe. Não foi enviado como mensagem a outro agente ou canal externo.
