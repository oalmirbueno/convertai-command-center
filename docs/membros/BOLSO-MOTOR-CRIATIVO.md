# Bolso e Mesa Ads: direção criativa compartilhada

Lote de 27/10/2026. Base verificada no `main` real do GitHub: `2feb169d`. Continuação do Bolso criado pelo Claude no commit `011e5101`. Implementação em `codex/bolso-estudio-criativo`, destinada a revisão; sem aplicação de schema, geração paga ou publicação automática.

## Resultado

O Bolso tem uma entrada mais limpa, com campanhas, marca e saldo separados visualmente. A criação segue Oferta, Texto e Arte, com continuidade explícita entre etapas. Explicações extensas ficam na ajuda recolhida. Demonstração, condições de acesso, crédito e bloqueios continuam visíveis quando relevantes. A administração usa o rótulo **Recomendações** no lugar de “Esteira de produtos”; os IDs e contratos internos do funil são preservados.

O núcleo `supabase/functions/_shared/motor-criativo-campanha.ts` é consumido pelos pedidos de texto e imagem do Bolso, pela copy e pela direção da arte do Mesa Ads. Ele não consulta dados, escolhe provedores, concede acesso nem movimenta créditos. Os dois produtos mantêm persistência e execução independentes.

## O que o núcleo orienta

1. Partir da situação concreta do público e de um benefício sustentado pela oferta.
2. Conectar ideia visual, argumento, headline, chamada e destino.
3. Variar o mecanismo da imagem: metáfora, detalhe cotidiano, escala inesperada, demonstração ou contraste de contexto.
4. Descrever uma cena concreta: protagonista, ação, enquadramento, luz, respiro e relação com o benefício.
5. Rever coerência, clareza, especificidade, verdade e próximo passo. Avaliação criativa não equivale a conversão medida.

No Mesa Ads, as variações recebem rotas visuais diferentes dentro do argumento escolhido. Tom sóbrio, estilo selecionado e referência autorizada continuam orientando a peça. O bloco adicional entra na ação de criação, sem ampliar o sistema global do estrategista. Na imagem, a direção chega aos compositores efetivos `promptDaLamina`, `promptDoReplicar` e ao caminho legado sem layout, somente para anúncios. Foto fixa conserva a cena autorizada e replicação conserva o nível de fidelidade escolhido. Posts orgânicos não recebem esse bloco.

## Contrato do Bolso

Os cinco campos persistidos continuam iguais: `mensagem`, `texto`, `cta`, `aplicacao` e `direcao_visual`. Nenhum campo ou tabela foi acrescentado.

- `mensagem`: headline curta, concreta e pronta para a arte, orientada a até 80 caracteres.
- `texto`: corpo da campanha ou legenda, sem despejar tudo na imagem.
- `cta`: próximo passo, orientado a até 50 caracteres.
- `direcao_visual`: descrição específica da cena, composição e ligação com a oferta.
- O pedido de imagem recebe somente headline e CTA da versão escolhida como textos autorizados. Não deve inventar ou resumir conteúdo.
- Saída nova do fornecedor de texto que ultrapassa 80/50 é recusada sem truncamento; segue o tratamento existente de falha definitiva e devolução do crédito.
- Versão histórica ou manual com texto maior que o limite, ou sem mensagem principal, mantém todo o conteúdo e gera imagem-base sem tipografia. A tela avisa antes da solicitação, permitindo editar primeiro. Esse limite não corta nem impede consultar o histórico.

O contrato por prompt não garante renderização literal de tipografia por um modelo de imagem. Conferir acentos, texto, composição e correspondência com a oferta continua parte da revisão humana. O fornecedor real ainda precisa de homologação.

A validação de condições comerciais passou a comparar valores completos, incluindo centavos e porcentagens. Antes, o preço capturava apenas o primeiro dígito e podia confundir R$ 12 com R$ 19. Os testes protegem contra mudança de preços, prazos e parcelamento, distinguindo escala visual de condição comercial. Isso é uma verificação determinística limitada, não uma prova geral de veracidade semântica.

## Pesquisa complementar

A base anterior permanece em `docs/conhecimento/natalia-torres.md` e `docs/mesa-ads/pesquisa/DOSSIE-CRIATIVOS.md`. Esta rodada verificou fontes públicas e observou seis peças do portfólio atual. Não acessou cursos privados, ouviu podcasts completos nem encontrou métricas individuais dessas peças.

| Fonte | Uso nesta rodada |
|---|---|
| [Ads Rocket](https://adsrocket.com.br/) | Portfólio e conexão entre público, oferta e criativo |
| [Natália Torres](https://nataliatorres.com.br/) | Identidade e associação à agência |
| [Black Box Ads](https://blackboxads.com.br/) | Organização do acervo por nicho; alegações comerciais não viram prova de cada criativo |
| [Vantablack Ads](https://vantablackads.com/ob-2/) | Contexto público do produto; sem acesso a aulas privadas |
| [Meta Blueprint](https://www.facebookblueprint.com/student/path/253130-increase-campaign-performance-with-diversified-creative) | Diversificação por conceito, motivador e formato |

Inferências da leitura visual: um foco dominante; fotografia cotidiana, macrotextura e metáfora; texto curto; imagem e frase completando o mesmo argumento. Impacto não significa usar preto, neon e 3D em todas as marcas. Esses padrões foram sintetizados, sem copiar peças ou atribuir a terceiros as artes da Aceleriq. Nenhuma referência foi adicionada à interface pública.

## Isolamento e operação

- Bolso continua usando apenas marca e campanha do próprio membro, com projeção explícita dos campos enviados ao provedor.
- Mesa Ads mantém contexto do cliente e sua autorização atual.
- RPCs, RLS, buckets privados, confirmações de consumo, filas, idempotência, limites e kill switch não foram alterados.
- Provedor simulado permanece explicitamente demonstrativo. Pagamentos e geração real não foram ativados.
- TypeSafe/Jev existente no Mesa Ads foi preservado. Não se adicionou chamada, credencial, dependência ou serviço novo.
- Não há migration neste lote.

## Conferência e publicação

A prévia visual usa os componentes reais com fixtures locais isoladas. O cliente Supabase e o contexto de autenticação são substituídos apenas no harness fora do repositório; CSP bloqueia conexões externas. Isso verifica layout e interação, não autorização ou produção. Os testes existentes cobrem gates e isolamento no código.

Antes da publicação:

- Conferir biblioteca, entrada do Bolso, formulário de marca, campanha, texto e arte em desktop e celular.
- Conferir Recomendações na administração e a preservação dos acessos.
- Verificar modo fechado, pausado, simulado, saldo insuficiente, custo e confirmação.
- Homologar o provedor real com orçamento e política comercial aprovados em uma etapa separada.
- Rever o PR e publicar frontend e funções de acordo com o fluxo existente; merge em `main` pode disparar publicação do frontend.

Rollback lógico: reverter apenas este lote no código e republicar as versões anteriores pelo fluxo aprovado. Não apagar campanhas, versões, artes, créditos ou histórico; não há SQL a desfazer. A matriz de testes e seus resultados ficam registrados no PR.
