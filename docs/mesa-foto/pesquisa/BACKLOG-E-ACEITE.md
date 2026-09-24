# Backlog proposto e evidências de aceite

Os lotes são uma sequência recomendada. Esforço, prazo e contratos finais devem ser estimados pelo Claude Code após reconhecer a base atual. Não há prazo comercial prometido.

| Lote | Entrega | Dependências | Evidência de aceite |
| --- | --- | --- | --- |
| 0. Reconhecimento | Mapa de componentes, entidades e adapters existentes; desenho da integração | Main atual e instruções canônicas | Lista do que será reutilizado e das lacunas, sem duplicar sistemas |
| 1. Kit e acervo | Agrupamento, papéis de referência, atributos, lacunas e originais | Permissões, storage e acervo | Mouse e caixa no mesmo kit; variantes e clientes separados |
| 2. Preparação | Recorte, máscara, fundo, versões e comparação | Kit e serviço de imagem | Primeiro plano/regiões protegidas preservados e originais recuperáveis |
| 3. Ensaio | Receitas, tomadas, jobs e estimativa | Motor e carteira existentes | Uma execução real com estados, custo conciliado e falhas visíveis |
| 4. Ângulos | Presets de câmera e adapter especializado validado | Comparativo de modelos e licença | Tomadas confrontadas com evidências; nenhum compromisso falso de geometria |
| 5. Pessoas e alimentos | Critérios específicos, referências e revisão | Kits autorizados e receitas avaliadas | Identidade preservada na amostra; porções/ingredientes conferidos |
| 6. Uso integrado | Selecionar foto na Mesa do Cliente e Mesa Ads | Versões aprovadas | Mesma origem rastreável até o criativo, sem aprovação herdada indevidamente |
| 7. Escala | Lotes, cache, métricas e orçamento | Fluxo individual estável | Custo por foto aprovada e tempo de revisão medidos |
| 8. Avançado | Treino/3D somente onde trouxer ganho | Volume e retorno demonstrados | Comparação que justifique complexidade adicional |

## Casos indispensáveis para verificação

1. Foto duplicada não duplica desnecessariamente o arquivo; embalagem e produto não são mesclados como duplicatas.
2. Mudança de cliente invalida seleção de referências e cache do cliente anterior.
3. Referência removida/inacessível não é substituída por outro produto automaticamente.
4. Regiões protegidas permanecem corretas após máscara e composição.
5. Nova vista é identificada como gerada; detalhes desconhecidos são conferidos.
6. Operação sem máscara não substitui silenciosamente uma edição que depende de máscara.
7. Falha/timeout mantém parâmetros para retomar sem cobrar duas vezes internamente.
8. Callback repetido é idempotente; orçamento insuficiente bloqueia o disparo do job.
9. Cancelamento não promete estorno de trabalho já executado externamente.
10. Reprovação mantém motivo, fontes e versão; correção não altera a aprovação histórica.
11. OCR ilegível vira revisão, não texto inventado no rótulo.
12. Rosto, mãos, cabelo e acessórios são comparados; alimento não ganha ingredientes/volume automaticamente.
13. Exportação conserva perfil de cor/formato pretendido e não corta o assunto essencial.
14. Foto aprovada entra nas mesas atuais e o anúncio resultante segue sua própria aprovação.

## Avaliação dos modelos

`PLANO-DE-AVALIACAO.csv` contém 20 kits × 4 tarefas. Duplicar cada caso por motor aplicável e preencher somente após executar. Guardar fontes e resultados, modelo/versão, data, parâmetros, tamanho, tempo, custo e decisão do revisor. Amostra final não deve conter só os exemplos mais bonitos.

Avaliar qualidade e operação separadamente. A nota visual sugerida é 40% fidelidade, 25% acabamento, 20% composição e 15% marca. Um erro crítico reprova a imagem mesmo com nota alta. Limiares e peso de cada categoria são ajustáveis, não fatos comprovados pela pesquisa.

## Definição de concluído

Concluir somente após demonstrar o caminho completo no ambiente apropriado, testes relevantes do projeto, revisão das alterações, evidências visuais e identificação dos limites restantes. Seguir o processo de PR/migrations/publicação do repositório. A documentação atual não autoriza pular essas etapas nem afirma que elas já foram realizadas.
