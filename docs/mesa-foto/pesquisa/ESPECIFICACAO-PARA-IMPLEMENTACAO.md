# Especificação proposta: Estúdio Fotográfico

24/09/2026 • Documento de passagem para implementação. Nenhum item abaixo deve ser lido como funcionalidade já publicada.

## Objetivo e integração

Criar uma área especializada no painel existente para preparar fotos e produzir ensaios de produtos, alimentos e pessoas. Reusar autenticação, cliente selecionado, acervo, storage, carteira, catálogo de modelos e aprovação. Rota sugerida: `/estudio-fotografico`, a confirmar no lote de UX.

Fontes verificadas: checkout `C:/AI/lf-verify`, commit local `54dcbb00`, documentação da Mesa v3 e Mesa Ads. Antes de codificar, recuperar o estado remoto atual e ler as instruções do repositório canônico. Não editar o clone compartilhado sem coordenação do escritor do lote.

## Fluxo de interface

1. **Acervo:** fotos do cliente, busca, filtros, indicação de original/derivada e upload em lote. Sugestões de agrupamento são confirmáveis.
2. **Kit:** selecionar produto, pessoa, alimento ou outra categoria; associar referências; registrar lacunas e atributos que precisam permanecer iguais.
3. **Preparar:** antes/depois, máscara editável, fundo transparente/branco/cenário, cor, exposição e regiões protegidas.
4. **Ensaio:** selecionar receita, tomadas e formatos; mostrar fontes utilizadas, prévia da lista e estimativa de custo antes de executar.
5. **Revisar:** grade comparativa com originais, sugestões e diferenças; rejeitar, ajustar ou aprovar cada tomada.
6. **Usar:** salvar no acervo como nova derivada e selecionar “Usar na Mesa do Cliente” ou “Usar na Mesa Ads”. Aprovar uma foto não aprova automaticamente o anúncio composto com ela.

Na tela, usar linguagem de fotógrafo: tomada, cenário, iluminação, proximidade, preservar produto, criar novo ângulo. Parâmetros de sampler, seed e LoRA ficam nos detalhes técnicos. Identificar geração sintética e alteração de partes não observadas de maneira simples.

Não aplicar automaticamente à fotografia regras específicas da capa das artes, como fundo escuro. Catálogo branco e estética de alimentos/pessoas exigem presets próprios.

## Reuso e entidades propostas

| Existente | Reaproveitar | Complemento proposto |
| --- | --- | --- |
| `cliente_imagens` | Origem, bucket, caminho, descrição e tags | Relações com kits e linhagem das derivadas |
| `cliente_kit_marca` | Paleta, referências e identidade | Receita fotográfica por cliente |
| `ia-motor` / catálogo | Chamadas, uso, configuração e carteira | Capacidade por operação e por modelo |
| `imagem-local.ts` | Máscara, recorte e restauração de regiões | Composição do assunto e controle de regiões protegidas |
| `estudio_trabalhos` | Ponto de consumo por artes/ads | Vínculo com foto aprovada, sem assumir que todo ensaio é um card |
| Aprovação atual | Versões, equipe e cliente | Revisão específica da foto e herança das regras existentes |

Entidades lógicas novas, sujeitas à revisão do schema antes de qualquer migration:

- `foto_entidades`: cliente, tipo, nome, variante, atributos confirmados, fontes dos atributos e lacunas.
- `foto_referencias`: entidade, imagem do acervo, papel (identidade, detalhe, embalagem, pose, estilo ou cenário), vista observada e prioridade.
- `foto_ensaios`: cliente, entidade, receita versionada, finalidade, formatos, orçamento e status.
- `foto_tomadas`: ensaio, câmera desejada, cenário, luz, referência, regiões protegidas e tratamento permitido.
- `foto_jobs`: tomada, operação, provedor/modelo/versão, identificador externo, custo estimado/real, tentativas e falhas.
- `foto_versoes`: imagem resultante, originais envolvidos, máscaras, transformação aplicada, checksum e avaliação.
- `foto_revisoes`: versão, avaliador, critérios, motivo de rejeição, aprovação e data.

Todas as entidades devem carregar escopo de cliente. As tabelas acima são propostas de responsabilidade, não uma determinação de criar sete tabelas: o desenho físico deve evitar duplicação com o que já existe.

## Identificação e ingestão

Validar formato pelo conteúdo, tamanho e dimensões; normalizar orientação; manter original; produzir thumbnail. Registrar checksum para duplicata exata e usar comparação visual apenas como sugestão para fotos parecidas. Duas variantes de produto não podem ser mescladas pela semelhança da embalagem.

Pipeline proposto: regras de arquivo → visão/OCR → descrição com evidências → agrupamento sugerido → confirmação do kit. Manter `observado`, `informado` e `inferido` separados. Preencher “não confirmado” quando faltar evidência.

TypeSafe pode julgar descrições estruturadas e escolher uma receita entre candidatas; ele não recebe os pixels. Reutilizar o catálogo existente e calibrar as decisões em português com exemplos reais. Não transformar a confiança de classificação em prova de que o produto foi preservado.

## Contrato de capacidades

Cada adaptador informa operações realmente suportadas: recorte, alpha, máscara, composição, referências, novo ângulo, relighting, formatos, resoluções e modo assíncrono. Informar ainda limite de referências, disponibilidade na conta e fonte/data da configuração.

`gerar_tomada` deve receber IDs internos, receita e parâmetros declarados, nunca chaves ou caminhos arbitrários do navegador. As referências são resolvidas no servidor dentro do mesmo cliente.

Uma chamada que exige máscara não pode cair silenciosamente em um provedor sem máscara. Se o modelo falhar, manter a intenção e o nível de preservação; caso o fallback não consiga, devolver limitação explícita. Modelos e nomes comerciais devem ser configuráveis, sem espalhar IDs por componentes de UI.

## Ângulos e geração

A grade anexa possui 96 combinações da ficha Qwen: oito azimutes, quatro elevações e três enquadramentos. É uma especificação de presets, não um teste. Não tratar graus como geometria calibrada da imagem resultante.

As posições são relativas à vista de referência. A frente comercial do produto precisa estar definida no kit; não assumir que a imagem de entrada já corresponde a essa frente. Não trocar o lado do produto por espelhamento, pois isso inverte texto e assimetrias.

Endpoint fal pesquisado: `fal-ai/qwen-image-edit-2511-multiple-angles`, com `image_urls`, `horizontal_angle`, `vertical_angle`, `zoom` e opções de geração. A posição superior a 90° mencionada na API requer teste separado da grade LoRA documentada até 60°.

Definir por tomada: assunto, finalidade, evidências, câmera, cenário, iluminação, composição, detalhes invariantes, alterações permitidas e formato. Gerar cada tomada a partir das fontes do kit para reduzir deriva. Uma saída só pode virar referência de identidade adicional após revisão.

## Preservação e acabamento

No modo de preservação, gerar fundo e recompor o primeiro plano original; restaurar regiões protegidas no servidor após a geração. Testar diferença de pixels na mesma resolução de trabalho e com saída sem perdas. Após resize ou JPEG, a igualdade pixel a pixel não é um critério válido sem considerar a transformação.

Máscara de segmentação não é alpha de acabamento perfeito. Oferecer correção de bordas, descontaminação de cor e tratamento especial de vidro/cabelo. Transformações de escala/perspectiva também precisam de revisão visual.

Separar sombras de contato, reflexos e fundo em etapas lógicas. Evitar sombras duplas. Para relighting, comparar cor/material e regiões protegidas; não anunciar imutabilidade dos pixels do assunto. Ampliação final só depois da seleção, com revisão de caracteres, pele e texturas.

## Execução e custo

Operações longas entram em fila persistente e worker/API assíncrona. O request da interface cria o job e retorna estado, sem aguardar a geração inteira. Estados propostos: criado, na fila, executando, revisando, concluído, falhou e cancelado.

Usar idempotência por intenção de geração e versão, reservar orçamento antes do disparo, conciliar uso real depois e distinguir retry do mesmo job de nova variação paga. Callback duplicado não cria duas versões nem duas cobranças internas. Cancelamento local não deve ser apresentado como estorno garantido de um provedor que já executou.

Cachear operações reaproveitáveis: leitura, segmentação e thumbnails. Fixar versões de receitas/modelos no registro; seed sozinha não garante reprodução entre provedores ou atualizações. Guardar parâmetros e evidências próprias, sem credenciais.

Processamento GPU não deve rodar dentro das funções de borda atuais. Usar provedor hospedado ou worker dedicado quando houver justificativa de volume. ImageScript existente continua útil; Sharp só deve entrar onde o runtime Node for adequado.

## Revisão e critérios de aceite

Critérios funcionais mínimos para o primeiro lote:

- Mouse e caixa podem estar no mesmo kit com papéis diferentes.
- Produto semelhante de outro cliente não aparece em busca, referência ou job desse cliente.
- Original permanece disponível e uma derivada mantém sua linhagem.
- Foto preservada mantém regiões protegidas na resolução de trabalho.
- Modo de novo ângulo informa geração sintética e não promete detalhe oculto fiel.
- Retrato permite revisão da identidade e só usa referências autorizadas daquele kit.
- Falha, timeout, callback repetido e orçamento insuficiente têm estados claros.
- Aprovação se refere a uma versão imutável; ajuste gera nova versão.
- Foto selecionada abre na Mesa do Cliente e na Mesa Ads sem duplicar o histórico.
- Compatibilidade com os navegadores definidos pelo projeto é verificada antes de incorporar bibliotecas de canvas recentes.

Critérios visuais: produto/variante, rótulo, proporções, rosto, mãos, ingredientes, reflexos e sombra. OCR e modelos de visão apontam suspeitas; aprovação continua humana. No modo fiel, alterações comerciais críticas reprovam mesmo com alta nota estética.

## Lotes de implementação

1. Recuperar estado atual do repositório e desenhar UX sobre componentes existentes. Sem geração paga para provar navegação e vínculo entre imagens.
2. Implementar kits, preparação fiel, versões e retorno às mesas. Validar com um produto e uma pessoa autorizada.
3. Rodar o plano comparativo; escolher motores por tarefa e custo aprovado. Integrar ângulos e receitas gradualmente.
4. Adicionar lotes e métricas de eficiência após o fluxo individual estar estável.
5. Avaliar GPU, treino e 3D com volume e ganhos medidos.

Seguir o fluxo de branch, testes, draft PR, revisão e publicação definido pelo projeto. Esta pesquisa não cria schema, contrata APIs, faz deploy ou autoriza publicação de imagens.
