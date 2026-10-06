# Mesa Fotos: galeria e zoom

Lote complementar ao PR #40, solicitado por Almir em 05/10/2026. Não substitui o Estúdio por pauta nem o Canvas.

## Comportamento

- `Ampliar` usa zoom de inspeção entre 1x e 8x, roda, botões, arraste, pinça, teclado e ajuste à janela. Trocar de imagem reseta a vista. Nada altera o arquivo.
- A foto do Estúdio abre no clique. “Ver grande” abre a versão exibida, inclusive o depois; a comparação mantém o original disponível.
- A faixa inferior mostra seis fotos por página. “Organizar fotos” abre busca, grupos, aprovadas e seleção de até dez imagens na ordem escolhida para preparar na Agenda. Não aprova nem publica conteúdo.
- Linhagens com mais de dezesseis versões não são truncadas. A subida até a origem detecta ciclos, em vez de parar no décimo segundo tratamento.
- Composições têm zoom nas três áreas e galeria por produto/pessoa. Recuperam resultados de composições salvas no servidor, além do rascunho local; derivados seguem o vínculo real com a origem.
- Ferramentas do modelo abrem numa janela larga. Fotos e versões, criação de opções, vistas e detalhes em 4K ficam separados. As seções continuam montadas ao alternar, preservando pedidos e operações em andamento.
- A pasta visual do modelo reúne imagens persistidas em `foto_modelo_imagens` e tratamentos descendentes das cópias identificadas no acervo. Os arquivos existentes não são movidos.
- Uma variação copia a referência da persona para o acervo pelo contrato existente e usa `preparar` com modo cenário e gerador escolhido. Custo continua explícito. A âncora não é trocada automaticamente; resposta sem imagem não vira sucesso.
- O acervo ganha filtro pelas pastas reais já registradas.

## Continuidade e limites

Não há schema, migration, fornecedor novo, segredo, mudança de autenticação ou aprovação neste lote. O histórico remoto da composição usa a leitura existente dos cem canvases ativos mais recentes e os vínculos das fotos carregadas. Conteúdos antigos continuam acessíveis no Acervo/Canvas. A identificação das composições anteriores é compatível com o nome `Composição · ...` criado pelo PR #40.

Os testes de geração usam respostas controladas dos contratos existentes. Não equivalem a uma geração paga em cada fornecedor. Testes globais têm dívida anterior; comparar falhas com a base, sem elevar tetos ou ocultar falhas.

## Conferência visual

1. Abrir uma derivada no Estúdio; clicar na foto e aumentar zoom, arrastar e ajustar.
2. Abrir “Organizar fotos”, buscar uma versão, ampliá-la e retornar à galeria. Conferir ordem da seleção sem enviar conteúdo real.
3. Abrir Compor foto e conferir zoom no produto/modelo/resultado. Alternar produto e pessoa; versões não se misturam.
4. Abrir as ferramentas do modelo e alternar as quatro seções. Conferir a referência da variação e custo antes de executar.
5. Conferir pastas no Acervo e os fluxos existentes de aprovação/Agenda.

## Publicação e rollback

Frontend direto no Worker `aceleriq-painel`, pelo procedimento em `docs/hospedagem/CLOUDFLARE-PAGES.md`. Conferir o SHA em `/version.json`; um workflow verde que pulou deploy não comprova publicação. Backend permanece nas versões do PR #40.

Rollback: retornar à versão anterior do Worker. Não apagar fotos, composições nem rascunhos. Checkout do Claude permanece intacto; integrar o PR pelo Git depois de preservar suas alterações locais.
