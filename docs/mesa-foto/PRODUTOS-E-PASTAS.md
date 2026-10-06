# Produtos e pastas da Mesa Foto

Atualização de 06/10/2026. A bancada da Mesa Estúdio permanece preservada.

## Uso

- Em **Mais → Organizar produtos**, ou em **Organizar produtos** no seletor, marque os produtos e informe uma pasta existente ou nova. Use `/` para níveis, por exemplo `Óculos / Sol`. A pasta vazia retira a organização, sem apagar produto ou arquivo.
- **Marcar fotos como produto** permite selecionar fotos do mesmo produto, escolher entre produto e embalagem e cadastrar manualmente ou acrescentar a um produto existente. O cadastro manual não usa IA. Gerações sem aprovação e referências da internet não entram nesse cadastro como fotos reais.
- **Reconhecer pela foto ou caixa** reutiliza a leitura visual existente, com custo exibido, para até seis fotos. Funciona com produtos sem embalagem e sem marca; uma identificação incerta continua rascunho, com lacunas para conferir. Uma caixa opaca não comprova detalhes invisíveis do objeto dentro.
- **Gerações** separa produto, modelo e clone; os filtros permitem encontrar as combinações. Abrir uma foto leva ao editor existente. Fotos, seleção do acervo e seletor de produto compartilham as pastas.
- **Editar produto** mantém o editor completo anterior, incluindo papéis das referências, autorização e lacunas. O atalho antigo que envia fotos para montar um produto é recebido pelo novo cadastro.

## Persistência e compatibilidade

- Pastas de produtos são metadados em `foto_kits.atributos.organizacao.pasta`. Nenhuma migration, cópia ou movimentação física de arquivo é necessária. A origem do Workspace permanece intacta.
- `produto_organizar { client_id, kit_id, pasta }` confere acesso, cliente do produto e concorrência por `atualizado_em`. Altera somente organização. Uma falha parcial na movimentação em lote informa quantos itens foram concluídos e permite tentar novamente.
- `kit_salvar` aceita a organização no contrato existente e preserva o campo quando um editor antigo o omite. Ao marcar um produto, classifica todas as referências de produto selecionadas, preservando os demais papéis.
- Pastas de gerações são visões dos vínculos persistidos, não diretórios de Storage. Agrupamento usa IDs de produto e pessoa; nomes servem somente para exibição. Renomear uma pessoa não quebra a associação.
- Gerações antigas de Canvas usam o snapshot `foto_canvas_geracoes.montado.referencias`, sem consultar a versão atual editável do Canvas. As novas composições incluem o `clone_id`, validado no servidor contra cliente e foto de identidade, e gravam a tag `clone:<id>`. Vínculos ambíguos antigos ficam sem pessoa identificada, em vez de presumir alguém.
- Tratamentos herdam os vínculos da origem. Uma nova composição não herda indevidamente a pessoa presente na foto usada como produto. Versões e fotos aprovadas não são removidas.
- Produtos sem marca/modelo confirmados não são unidos por nome genérico; fotos em comum podem identificar o mesmo cadastro. Leitura de pasta não cobra IA nem aprova conteúdo.

## Validação e retorno

Testes de interação cobrem cadastro sem IA, embalagem, reutilização de produto, seleção por pasta, falha de gravação e proteção das referências. Testes de regras cobrem roundtrip da pasta, deduplicação, cliente, homônimos, clones, snapshots e linhagem. Executar também suites existentes de Mesa Foto, Canvas e catraca visual, TypeScript da aplicação, Deno check de mesa-foto e build.

Rollback do código: revisão anterior `e5d4d0c1c897445b2d136cc8594e21802e8e45b3`, função mesa-foto v48. Metadados novos podem permanecer: não exigem reversão do banco. Não apagar mídias ou histórico para reverter esta interface.
