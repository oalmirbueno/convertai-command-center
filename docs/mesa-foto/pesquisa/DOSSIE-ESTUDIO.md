# Mesa de Estúdio Fotográfico

Pesquisa e proposta para o Aceleriq OS • 24 de setembro de 2026

**Recomendação:** criar uma mesa própria de fotografia, ligada ao acervo e às outras mesas do painel. Ela recebe os materiais reais do cliente, organiza produtos e pessoas em kits, prepara fotos e produz ensaios reutilizáveis em anúncios, artes e páginas de venda.

O diferencial será a combinação de identidade bem documentada, direção fotográfica, preservação do material original e revisão de qualidade. Um gerador de imagens isolado não resolve esse conjunto.

## 1. O que foi pesquisado e o que está comprovado

Foram consultados **32 repositórios no GitHub**, fichas de modelos, documentação de APIs e materiais de fotografia. O catálogo anexo registra endereço, licença identificada pelo GitHub, estado de arquivamento e data de atualização. A seleção privilegia aplicação na mesa, possibilidade de integração e limitações comerciais; popularidade não foi usada como prova de qualidade.

Esta é uma pesquisa documental com proposta de arquitetura. **Nenhum modelo foi instalado ou comparado com fotos de clientes nesta etapa.** Recursos anunciados pelos autores não equivalem a qualidade comprovada no nosso caso. A cobertura é ampla e selecionada, não um inventário de todos os repositórios existentes. Disponibilidade, preços e versões devem ser rechecados na integração.

Consultei o contexto da Mesa v3 e o checkout local `C:/AI/lf-verify`, no commit `54dcbb00`, datado de 23/09/2026. Nele existem `/mesa`, `/mesa-ads`, acervo `cliente_imagens`, kit de marca, referências, motor de IA, edição por máscara e restauração dos pixels fora da área editada. Isso fundamenta o reaproveitamento proposto. Não foi feita auditoria do painel em produção nem sincronização desse checkout com o remoto.

Fontes locais: `docs/mesa-do-cliente/SPEC.md`, `CONTRATOS-V3.md`, `docs/mesa-ads/SPEC.md` e `docs/architecture/ACELERIQ-CONTEXTO-CANONICO.md`. As notas do segundo cérebro descrevem publicação, mas essa afirmação não foi retestada aqui.

## 2. Como a mesa deve funcionar

Proposta de navegação: **Acervo → Preparar → Ensaio → Revisar → Usar nas mesas**.

| Área | O que a equipe faz | O que a inteligência ajuda a fazer |
| --- | --- | --- |
| Acervo | Sobe fotos, seleciona cliente e agrupa materiais | Sugere produto, embalagem, pessoa, ambiente, duplicatas e fotos ruins |
| Kit do assunto | Confirma quais imagens mostram o mesmo produto ou pessoa | Aponta fotos complementares e características ainda desconhecidas |
| Preparar | Recorta, limpa, corrige cor, remove fundo e ajusta luz | Propõe máscara, tratamento e enquadramento |
| Ensaio | Escolhe finalidade, cenário, luz, ângulos e formatos | Monta uma lista de tomadas e gera as opções |
| Revisar | Compara com o original, aceita ou corrige | Sinaliza texto alterado, acessórios inventados, bordas e inconsistências |
| Usar | Salva uma versão e envia para a Mesa do Cliente ou Mesa Ads | Prepara os formatos necessários mantendo a origem do material |

**Uma biblioteca compartilhada, com uma área especializada de trabalho.** O usuário pode entrar pelo menu Estúdio Fotográfico ou pelo botão “Preparar foto” dentro das mesas atuais. A nova área devolve ativos fotográficos; a composição de anúncio continua no fluxo existente.

No acervo, “mouse” e “caixa do mouse” são arquivos distintos ligados à mesma entidade, não duplicatas. Cor, modelo e variante devem ser confirmados antes de agrupar. Uma caixa não comprova sozinha a geometria do objeto que está dentro.

## 3. Três modos que precisam estar claros

| Modo proposto | Operações | Compromisso com o original |
| --- | --- | --- |
| Preservar produto/pessoa | Fundo, enquadramento, recorte, composição | Reutilizar o primeiro plano original e limitar mudanças às regiões permitidas |
| Tratar fotografia | Cor, exposição, limpeza localizada, relighting | Alterar aparência fotográfica sem mudar identidade, conteúdo ou atributos comerciais |
| Criar ensaio | Novo ângulo, pose, cenário complexo, interação | Produzir imagem sintética derivada, com validação explícita das características |

Preservar pixels e refazer a iluminação são objetivos diferentes. Ao mudar a luz sobre o objeto, seus pixels mudam. A interface deve indicar esse alcance e permitir proteger rótulo, logo, rosto ou outras áreas. Novo ângulo não admite a promessa de “todos os pixels preservados”.

**Exemplo do mouse:** com fotos do produto e da caixa, montar um kit e produzir fundo branco, composição com embalagem, cenário de mesa de trabalho e detalhes. Se só existe uma foto da caixa, solicitar uma foto do produto ou referência oficial do mesmo modelo. Pode haver uma prévia conceitual, identificada como tal, mas não um catálogo que apresente detalhes desconhecidos como reais.

## 4. Motores e serviços: seleção para comparar

Não recomendo contratar todos. Começar pelos provedores que o motor atual já suporta e adicionar especialistas quando o ensaio comparativo demonstrar ganho.

| Candidato | Melhor papel na mesa | Decisão recomendada |
| --- | --- | --- |
| [OpenAI Images](https://developers.openai.com/api/docs/guides/image-generation) | Edição dirigida, máscaras e composições com referências | Linha de base pelo encaixe no motor existente. Fixar modelo e parâmetros; a documentação consultada já distingue a família GPT Image 2.5 de modelos anteriores |
| [Gemini Image](https://ai.google.dev/gemini-api/docs/image-generation) | Várias referências, instruções em conversa e ensaios | Segunda linha de base. A documentação descreve até 14 referências, com limites por tipo de conteúdo/modelo; não tratar isso como 14 identidades igualmente garantidas |
| [Photoroom API](https://docs.photoroom.com/) | Recorte, fundo, sombra, expansão e iluminação para catálogo | Primeiro especialista a comparar para produtos e lotes |
| [Bria Product Shots](https://docs.bria.ai/product-shots-best-practices) | Produto preservado dentro de novos cenários | Comparar com Photoroom. A documentação distingue composição em torno do produto de operações que o regeneram |
| [FLUX.2](https://docs.bfl.ai/flux_2/flux2_image_editing) | Edição com várias referências e cenas comerciais | Alternativa para diversidade e contingência. A página consultada diferencia até 8 referências via API e 10 no playground; verificar endpoint escolhido |
| [Qwen Edit + Multi-Angles](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA) | Geração controlada de vistas | Candidato prioritário para o módulo de ângulos, por API ou execução própria |
| [Seedream](https://seed.bytedance.com/en/seedream4_5) | Edição com referências e consistência de elementos | Incluir no comparativo se o provedor atual disponibilizar. A documentação da 4.5 detalha edição; o site também já apresenta [Seedream 5.0 Pro](https://seed.bytedance.com/en/seedream5_0_pro), sem que isso prove superioridade em fotos de produto |
| [Adobe Firefly Services](https://developer.adobe.com/firefly-services/docs/firefly-api/) | Composição de produto e fluxos com ferramentas Adobe | Opção quando o acabamento Photoshop/Adobe fizer parte da operação |
| [Higgsfield Product Shots](https://console.higgsfield.ai/models/workflows/product-shots/playground) | Ensaios e referências de experiência de uso | Avaliar recursos do produto e do endpoint separadamente. A presença de Angles na interface não comprova que a mesma operação esteja disponível na API contratada |

Um intermediário como fal ou Replicate é uma forma de hospedar/acessar modelos, não uma técnica de preservação por si só. Versão, configuração, preço, retenção e acesso comercial continuam sendo propriedades a verificar.

## 5. Como implementar os ângulos

Há três caminhos distintos:

1. **Presets por descrição:** frontal, três quartos, lateral, superior, detalhe. Integração simples com os geradores atuais; controle geométrico aproximado.
2. **Modelo especializado em câmera:** Qwen Edit com LoRA de múltiplos ângulos. Melhor candidato para controles explícitos no painel; ainda gera regiões que não estavam visíveis.
3. **Objeto 3D ou captura multivista:** reconstrução/modelagem, câmera e renderização. Adequado quando a mesma peça precisa de muitas vistas coerentes. Uma malha gerada de uma foto continua contendo hipóteses sobre o objeto.

A ficha da LoRA da fal descreve **8 orientações × 4 alturas × 3 distâncias = 96 posições**. Esse é o espaço de treinamento documentado, não uma garantia de 96 fotos corretas para qualquer produto. O [node ComfyUI-qwenmultiangle](https://github.com/jtydhr88/ComfyUI-qwenmultiangle) oferece um controle visual de câmera e produz instruções para o modelo; o visor não reconstrói automaticamente a geometria da foto.

Na interface, usar miniaturas de tomadas mais três controles: **lado da câmera, altura e proximidade**. Começar com posições discretas. A API [fal Multi-Angles](https://fal.ai/models/fal-ai/qwen-image-edit-2511-multiple-angles/api) expõe rotação horizontal, ângulo vertical e zoom. Ela descreve até vista superior de 90°, enquanto a ficha da LoRA enumera alturas até 60°: tratar 90° como capacidade a testar, fora da grade de 96 posições documentada.

Sugestão de pack inicial: frente, três quartos esquerdo/direito, lateral, detalhe, contexto de uso, produto com embalagem e uma foto principal de campanha. Nem todo kit terá material para todos os itens. “Detalhe” só deve ampliar um detalhe existente e verificável.

**Evitar uma cadeia de cópias:** cada tomada parte do kit original, junto de uma referência de estilo aprovada quando necessário. Gerar B a partir de A, C a partir de B e D a partir de C pode acumular alterações. Uma folha com várias vistas serve para planejar; as fotos finais devem ser geradas/exportadas individualmente, com resolução própria.

## 6. Repositórios: onde cada um ajuda

P1 = candidato prioritário; P2 = complemento; P3 = pesquisa ou fase posterior; R = restrição relevante. As classificações são recomendações desta pesquisa, não resultados de testes. Licenças abaixo se referem ao código ou declaração consultada; pesos, dependências e serviços podem ter outros termos.

### Motor, edição e controle

| Repositório | Aplicação | Prioridade e observação |
| --- | --- | --- |
| [QwenLM/Qwen-Image](https://github.com/QwenLM/Qwen-Image) | Geração/edição com referência; base do módulo de vistas | P1. Apache-2.0; confirmar checkpoint e adapter específicos |
| [black-forest-labs/flux2](https://github.com/black-forest-labs/flux2) | Edição multirreferência e alternativa de execução própria | P2. Código Apache-2.0; Klein 4B aparece como Apache-2.0, enquanto 9B/dev têm licença não comercial distinta |
| [Comfy-Org/ComfyUI](https://github.com/Comfy-Org/ComfyUI) | Experimentação de fluxos e execução em GPU | P1 no laboratório; GPL-3.0. Não expor nodes diretamente aos clientes |
| [huggingface/diffusers](https://github.com/huggingface/diffusers) | Transformar fluxo validado em serviço Python controlado | P1 para backend próprio. Apache-2.0; não é um modelo |
| [jtydhr88/ComfyUI-qwenmultiangle](https://github.com/jtydhr88/ComfyUI-qwenmultiangle) | Referência concreta para seletor visual de câmera | P1. MIT; implementação é Vue/Three.js, não um componente React pronto |
| [invoke-ai/InvokeAI](https://github.com/invoke-ai/InvokeAI) | Referência de canvas, máscaras e edição assistida | P2. Apache-2.0; estudar experiência, não substituir o painel |
| [lllyasviel/ControlNet](https://github.com/lllyasviel/ControlNet) | Controles de estrutura, profundidade e pose | P2. Apache-2.0; escolher variantes compatíveis com o modelo base |
| [tencent-ailab/IP-Adapter](https://github.com/tencent-ailab/IP-Adapter) | Condicionamento visual e referência de estilo | P2. Apache-2.0; não equivale a garantia de identidade |
| [ostris/ai-toolkit](https://github.com/ostris/ai-toolkit) | Treino de adapters para assuntos recorrentes | P3. MIT; dataset, modelo base e custo de treino precisam ser próprios do caso |

### Recorte, iluminação e acabamento

| Repositório | Aplicação | Prioridade e observação |
| --- | --- | --- |
| [ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | Separação do primeiro plano em alta resolução | P1. MIT; testar cabelo, fios, reflexos e transparências no checkpoint escolhido |
| [danielgatis/rembg](https://github.com/danielgatis/rembg) | Serviço/CLI para remover fundo com diferentes modelos | P1. MIT no pacote. Selecionar explicitamente o modelo; não presumir que todo peso suportado permite uso comercial |
| [facebookresearch/sam2](https://github.com/facebookresearch/sam2) | Seleção interativa e refinamento de regiões | P1. Apache-2.0; segmentação não resolve sozinha o acabamento de bordas |
| [facebookresearch/sam3](https://github.com/facebookresearch/sam3) | Segmentação orientada por conceitos | P2. Licença própria SAM, não presumir os mesmos termos do SAM2 |
| [IDEA-Research/GroundingDINO](https://github.com/IDEA-Research/GroundingDINO) | Localizar objetos por descrição | P2. Apache-2.0; útil se a segmentação escolhida não cobrir essa etapa |
| [lllyasviel/IC-Light](https://github.com/lllyasviel/IC-Light) | Relighting e harmonização de luz | P2. Código Apache-2.0; demo alerta sobre remoção de fundo BRIA não comercial. Revisar os pesos da variante usada |
| [xinntao/Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | Ampliação e restauração | P2. BSD-3-Clause; conferir escrita, textura e bordas após processar |
| [Fanghua-Yu/SUPIR](https://github.com/Fanghua-Yu/SUPIR) | Restauração generativa | R. Declaração não comercial; não adotar como padrão para clientes sem licença apropriada |
| [Sanster/IOPaint](https://github.com/Sanster/IOPaint) | Referência para inpainting/outpainting | R. Repositório arquivado na consulta; serve para estudo, não recomendação principal de manutenção |
| [lovell/sharp](https://github.com/lovell/sharp) | Resize, recorte, composição e exportação | P2. Apache-2.0; opção em worker Node, sem substituir à força o ImageScript já usado no Deno |
| [konvajs/konva](https://github.com/konvajs/konva) | Interação com camadas, seleção e anotações | P2. README declara MIT; validar compatibilidade com os navegadores suportados pelo painel |

### Pessoas e consistência

| Repositório | Aplicação | Prioridade e observação |
| --- | --- | --- |
| [instantX-research/InstantID](https://github.com/instantX-research/InstantID) | Preservação de identidade por imagem de referência | R. Código Apache-2.0, mas README restringe checkpoints próprios a pesquisa e aponta restrição dos modelos InsightFace |
| [ToTheBeginning/PuLID](https://github.com/ToTheBeginning/PuLID) | Personalização de identidade | P3/R. Código Apache-2.0; revisar cadeia de modelos, incluindo reconhecimento facial e base gerativa |
| [TencentARC/PhotoMaker](https://github.com/TencentARC/PhotoMaker) | Retratos com múltiplas referências de identidade | P3/R. Licença declara Apache-2.0 com exceções de terceiros; versão e dependências precisam de revisão |

Para a primeira implementação de pessoas, comparar as APIs já disponíveis antes de assumir uma infraestrutura de identidade própria. “Código aberto” não prova liberação de todos os pesos. A distinção também aparece na [documentação do InsightFace](https://github.com/deepinsight/insightface).

### 3D e multivista

| Repositório | Aplicação | Prioridade e observação |
| --- | --- | --- |
| [microsoft/TRELLIS.2](https://github.com/microsoft/TRELLIS.2) | Imagem para ativo 3D com materiais | P3. MIT para modelo/código segundo autores; README pede GPU NVIDIA de pelo menos 24 GB |
| [Tencent-Hunyuan/Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) | Geometria e textura para renders | P3/R. Licença comunitária própria com restrições territoriais; não tratar como MIT/Apache |
| [TencentARC/InstantMesh](https://github.com/TencentARC/InstantMesh) | Reconstrução de malha a partir de imagem | P3. Apache-2.0 no repositório; examinar modelos associados |
| [xxlong0/Wonder3D](https://github.com/xxlong0/Wonder3D) | Estudo de geração multivista e reconstrução | P3. MIT no código; útil como referência técnica |
| [colmap/colmap](https://github.com/colmap/colmap) | Reconstrução baseada em várias fotografias reais | P3. BSD declarada no README, dependências à parte; demanda cobertura e captura adequadas |
| [nerfstudio-project/nerfstudio](https://github.com/nerfstudio-project/nerfstudio) | Radiance fields e visualização de cenas capturadas | P3. Apache-2.0; maior custo operacional, não necessário para lançar a mesa |

3D fica para objetos recorrentes, giros e casos em que o ganho de consistência compensa captura, limpeza de malha e renderização. Um CAD oficial ou captura multivista verificada oferece evidência geométrica melhor que imaginar o verso de uma fotografia.

### Organização e controle de qualidade

| Repositório | Aplicação | Prioridade e observação |
| --- | --- | --- |
| [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | Ler e conferir modelo, rótulo e escrita | P1/P2. Apache-2.0; baixa confiança deve pedir revisão, não “corrigir” a embalagem automaticamente |
| [mlfoundations/open_clip](https://github.com/mlfoundations/open_clip) | Busca semântica e agrupamento visual | P2. GitHub retornou NOASSERTION; verificar licença do código e dos pesos escolhidos antes de integrar |
| [voxel51/fiftyone](https://github.com/voxel51/fiftyone) | Montar conjunto de avaliação e investigar erros | P2 para laboratório. Apache-2.0; não precisa virar interface do usuário |

## 7. Técnicas fotográficas que viram presets úteis

As configurações abaixo são propostas editoriais para testar, não instruções universais de modelo.

| Família | Direção | Tomadas úteis | O que conferir |
| --- | --- | --- | --- |
| Catálogo | Fundo uniforme, luz ampla, cor consistente | Frente, três quartos, verso real, detalhe | Variante, escala, bordas, rótulo e acessórios |
| Tecnologia | Luz lateral, controle de reflexos, contexto limpo | Três quartos, portas/botões, uso, embalagem | Portas, câmeras, conectores, tela e espessura |
| Cosméticos | Luz suave e reflexos controlados | Frasco, textura real, embalagem, composição | Texto pequeno, volume, cor e transparência |
| Alimentos | Luz lateral ou contraluz suave, textura natural | Vista superior para pratos planos; 45° para volume; lateral para camadas | Ingredientes, quantidade, ponto de preparo e tamanho |
| Pessoas | Luz principal suave, pele natural, cenário coerente | Retrato, meio corpo, corpo inteiro, contexto profissional | Rosto, idade aparente, óculos, mãos e acessórios |
| Moda/acessórios | Cor fiel, caimento e material claros | Frente, costas, detalhe e escala no corpo | Estampa, costura, proporções e item correto |

Para consistência de catálogo, padronizar altura da câmera, enquadramento, escala do produto, balanço de branco e direção de luz. A [Shopify orienta captura, fundos e iluminação](https://help.shopify.com/en/manual/products/product-media/product-photography); a [Adobe discute controle de estúdio](https://www.adobe.com/uk/creativecloud/photography/discover/product-photography.html). As regras entram em presets salvos por cliente, ajustados após revisão de exemplos reais.

Para alimentos, a aparência deve corresponder ao que o cliente entrega. Uma luz melhor pode valorizar textura; adicionar ingredientes e volume inexistentes muda a oferta. Para estudar a direção visual: [guia de fotografia de alimentos da Shopify](https://www.shopify.com/blog/food-photography-tips) e [aula da Adobe sobre fotografia e tratamento](https://helpx.adobe.com/in_hi/lightroom-classic/how-to/create-gorgeous-food-photography-lightroom-classic.html).

Na composição de produto, conferir sombra de contato, perspectiva, escala, temperatura de cor, nitidez e reflexos do ambiente. Se o endpoint já cria sombra e integração, não aplicar uma segunda sombra automática. O [guia técnico da Bria](https://docs.bria.ai/product-shots-best-practices) é uma boa referência dessa separação de etapas.

## 8. O kit visual de cada produto ou pessoa

Um kit deve guardar: entidade, variante, originais, referências aprovadas, imagens de detalhe, descrição factual, dimensões quando fornecidas, regiões protegidas, estilo aprovado e lacunas. Separar **observado na foto**, **informado pelo cliente** e **inferido**. Uma descrição inferida não deve virar especificação confirmada.

Como orientação inicial de captura, propor 4 a 8 fotos complementares de produtos e 6 a 12 de pessoas, adaptando ao caso. São quantidades operacionais sugeridas, não exigências dos modelos. Priorizar diversidade útil: frente, laterais, verso, detalhes e iluminação legível. Fotos repetidas do mesmo ângulo acrescentam pouco sobre partes ocultas.

Para pessoas, guardar autorização de uso e escopo junto do kit, permitir exclusão e restringir acesso ao cliente correto. A preservação de identidade deve ser confirmada pela pessoa/equipe; um score de semelhança pode auxiliar, mas não substitui essa revisão. Treinar LoRA só quando houver uso recorrente, base adequada e ganho demonstrado sobre referências simples.

A inteligência visual pode gerar descrições, tags e candidatos de agrupamento. **Jev/TypeSafe recebe texto, não imagens**, segundo a [documentação atual](https://docs.typesafe.ai/concepts/state). Seu papel possível é escolher receitas, priorizar lacunas e ordenar opções a partir de descrições/evidências produzidas por visão e regras. Não atribuir a ele inspeção direta de rosto ou produto.

## 9. Como escolher os melhores motores de verdade

Preparar um ensaio comparativo com 20 kits: 6 produtos rígidos, 4 embalagens/reflexivos, 4 alimentos e 6 pessoas autorizadas. Distribuir casos fáceis e difíceis. Propor 4 tarefas por kit e 3 motores por tarefa aplicável: até 240 saídas na primeira rodada. Algumas combinações podem não ser suportadas e devem ficar como “não aplicável”.

Usar o mesmo briefing, fontes e resolução final compatível; registrar a resolução nativa. Avaliar sem mostrar o fornecedor ao revisor. Repetir apenas os finalistas nos casos críticos para medir variação entre tentativas. O arquivo `PLANO-DE-AVALIACAO.csv` traz 80 casos vazios de resultado, sem métricas inventadas.

| Dimensão | Método |
| --- | --- |
| Identidade e produto | Comparação com originais e checklist específico do item |
| Texto/embalagem | OCR mais inspeção visual; confrontar apenas regiões que devem continuar legíveis |
| Ângulo e composição | Conferir tomada pedida, escala e perspectiva |
| Acabamento | Bordas, sombra, textura, pele, anatomia e reflexos |
| Operação | Tempo total, falhas, número de tentativas e minutos de retoque |
| Custo | Custo total dividido pelas fotos aprovadas, incluindo descartes |

Proposta de pontuação: fidelidade 40%, acabamento 25%, composição 20%, aderência à marca 15%. **Erro crítico de identidade, variante, ingrediente ou informação comercial reprova independentemente da média.** Os pesos e metas são critérios propostos para o piloto; não resultados já alcançados.

Qualidade visual também não comprova aumento de vendas. Depois de aprovar as fotos, testar o uso comercial na Mesa Ads com controle de oferta, público e período, avaliando os resultados do negócio.

## 10. Custos e sequência recomendada

O custo relevante é **por foto aprovada**: geração + referências de entrada + recorte + ampliação + armazenamento + revisão + tentativas descartadas. Um motor mais barato por chamada pode custar mais se exigir muitas correções.

A [página da API Photoroom](https://www.photoroom.com/api/pricing), consultada nesta data, cita US$ 0,02 por chamada Basic e US$ 0,10 por Plus nas regras de consumo entre planos. A [documentação de cobrança](https://docs.photoroom.com/getting-started/pricing) explica que assinatura da API é separada do aplicativo e oferece sandbox com marca d’água. Esses valores não são orçamento total do estúdio e devem ser confirmados no plano contratado.

Exemplo puramente aritmético: 100 processamentos a US$ 0,10 custam US$ 10 nessa etapa. Se só 50 forem aprovados, essa parcela já representa US$ 0,20 por foto aprovada. Custos dos demais motores não foram orçados em conta autenticada.

**Lote 1:** kit de produto/pessoa, acervo compartilhado, fundo/recorte, versões, revisão e retorno para as mesas. Preservar o motor, carteira e aprovação existentes.

**Lote 2:** ensaios de produtos, alimentos e retratos com várias referências, biblioteca de receitas e controle de ângulos. Liberar cada receita conforme os resultados do comparativo.

**Lote 3:** processamento em lote, recomendações por cliente, LoRAs quando justificadas e 3D para produtos recorrentes. Infraestrutura GPU própria só depois de medir demanda e custo.

O primeiro marco verificável deve ser: subir o kit de um produto e o kit de uma pessoa, preparar versões, gerar tomadas, revisar diferenças e reutilizar as imagens nas mesas atuais sem perder histórico. A proposta técnica detalhada está em `ESPECIFICACAO-PARA-IMPLEMENTACAO.md`.

## 11. Pontos ainda em aberto

- Modelo vencedor por categoria, fidelidade, latência e custo real: dependem do comparativo.
- Compatibilidade dos serviços com a conta e catálogo atuais: não testada com geração paga.
- Licença completa de cada combinação de modelo, adapter e dependência: revisão antes da implantação.
- Atualidade do checkout em relação ao remoto/produção: conferir no início da implementação.
- “JetDetector”, citado no pedido, não foi identificado com segurança; nenhuma recomendação depende dessa identificação.

O pacote inclui catálogo verificável, grade de 96 presets, oito receitas iniciais de ensaio, plano de avaliação e especificação de integração. A pesquisa foi registrada no inbox do segundo cérebro, sem alterar a memória consolidada ou o painel.
