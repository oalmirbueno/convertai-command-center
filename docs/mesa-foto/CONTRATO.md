# Mesa Foto: contrato entre as frentes

Data: 2026-09-24. Pesquisa e especificação do dono em `docs/mesa-foto/pesquisa/` (ler `CLAUDE.md`, `ESPECIFICACAO-PARA-IMPLEMENTACAO.md`, `BRIEFING-E-EXPERIENCIA.md`, `BACKLOG-E-ACEITE.md`, `receitas-ensaio.json`, `presets-angulos.json`, `CONTRATOS-EXEMPLO.json`).

Pedido do dono: uma terceira mesa, "Mesa Foto", na mesma base da Mesa e da Mesa Ads (que "estão sensacionais"), para o estúdio fotográfico: muito upload de fora, usar todo o contexto do cliente (história, porquê, marca), preparar e melhorar fotos, criar cenários, novos ângulos e ensaios profissionais de produtos, alimentos e pessoas; baixar a foto, mandar para Arquivos, mandar para aprovação ou enviar para o Estúdio (Mesa e Mesa Ads). Pronto para uso.

## Regras duras (da pesquisa e da casa)

- Original imutável; toda alteração vira versão derivada rastreável (linhagem até o original).
- Identidade do assunto (produto, pessoa, alimento) separada de referência de estilo, cenário ou pose.
- Embalagem não é o produto. Sem evidência, não inventar detalhe; lacuna fica escrita.
- Modos distintos, sempre ditos na tela: **Preservar** (máscara + pixels originais de volta), **Tratar luz e cor**, **Novo cenário**, **Novo ângulo** (gera partes não vistas: marcado como "gerado", sem garantia de fidelidade).
- Imagem gerada não vira referência de identidade sem aprovação.
- Pessoas: só foto autorizada do próprio cliente; retoque não muda anatomia, idade, rosto.
- Alimento: não aumenta porção nem inventa ingrediente.
- Nada de laço de correção automática (dono, 24/09): gera uma vez, confere uma vez (visão + Jev como aviso), a equipe decide. Refazer pede variação real.
- Nunca escurecer a foto para dar destaque; regras da capa de artes NÃO se aplicam à fotografia.
- Custo sempre à vista antes de gerar (padrão BotaoComCusto/estimativa da Mesa); carteira e ia_usos existentes.
- Funções longas respondem com fôlego (`_shared/resposta-com-folego.ts`) e chamadas de texto com `timeoutMs` adequado (padrão 120 s corta).
- Compatibilidade Safari 11 / Chrome 64; queries só com JSON; português claro; SEM travessão.

## Donos de arquivo

| Frente | Arquivos |
| --- | --- |
| A. Servidor Mesa Foto | `supabase/functions/mesa-foto/**`, `src/test/mesa-foto-servidor*.test.ts`, SQL em `docs/mesa-foto/migrations/`, `supabase/config.toml` (só a entrada `[functions.mesa-foto]`) |
| B. Front Mesa Foto | `src/pages/MesaFoto.tsx`, `src/components/mesa-foto/**`, rota em `src/App.tsx` (só a linha nova dentro da rota-mãe da casca), link em `src/pages/AdminExperience.tsx`, troca entre mesas (links "Mesa · Mesa Ads · Mesa Foto") onde já existe a barra das mesas, `src/test/mesa-foto-ui*.test.tsx` |
| C. Ads ZIP + MCP | `src/components/mesa-ads/PacoteDaCopy.tsx` (e um arquivo novo `src/components/mesa-ads/zipDoGestor.ts`), `supabase/functions/_shared/mcp-tools.ts`, `supabase/functions/mcp-server/**`, `src/lib/mcp/**`, testes `src/test/mcp-*.test.ts` e `src/test/mesa-ads-zip*.test.ts` |

Ninguém aplica migration, faz commit, push ou deploy.

## Banco (frente A escreve o SQL)

Reaproveitar `cliente_imagens` como acervo único (a mesma foto serve Mesa, Mesa Ads e Mesa Foto):
- `cliente_imagens` ganha: `derivada_de uuid` (linhagem), `gerada boolean default false`, `modo text` (preservar|luz_cor|cenario|angulo|ensaio|null), `kit_id uuid null`, `sha256 text`, `largura int`, `altura int`, `aprovada boolean default false`; `origem` aceita também `'mesa_foto'`.
- `foto_kits` (id, client_id, tipo produto|pessoa|alimento|bebida|cosmetico|moda|tecnologia|outro, nome, variante, atributos jsonb {observado[], informado[], inferido[]}, invariantes text[], lacunas text[], autorizacao jsonb (pessoas), frente_imagem_id, status, criado_por, criado_em, atualizado_em).
- `foto_kit_refs` (kit_id, imagem_id, papel identidade|detalhe|embalagem|verso|rotulo|rosto|corpo|pose|estilo|cenario, vista text, prioridade int). Unique (kit_id, imagem_id, papel).
- `foto_ensaios` (id, client_id, kit_id, receita_id, receita_versao, finalidade, formatos text[], tomadas jsonb (lista com id, nome, camera {azimute, elevacao, enquadramento}, cenario, luz, modo, invariantes, formato, status, versoes [{versao, imagem_id, storage_path, custo_usd, conferencia, aprovada, motivo_rejeicao, criado_em}]), custo_usd, status, criado_por, criado_em, atualizado_em).
- RLS igual às tabelas da Mesa (equipe com `is_staff` + `can_access_client`); escrita pela função (chave de serviço).

## Ações da função `mesa-foto` (frente A implementa; B consome)

POST `{ acao, ... }`, só equipe com acesso ao cliente. Resposta com `custo_usd`/`saldo_usd` quando usa IA; erro `{ error, mensagem }`.

- `acervo_registrar { client_id, caminhos: string[] (já no bucket mesa em <client_id>/foto/originais/...), nomes? }` -> `{ imagens, duplicadas }`. Lê bytes, valida tipo pelo conteúdo, dimensões, sha256 (duplicata exata não duplica), cria `cliente_imagens` origem 'mesa_foto'.
- `acervo_ler_foto { client_id, imagem_id }` -> leitura por visão: `{ descricao, observado[], texto_lido, qualidade {nitidez, luz, enquadramento, problemas[]}, sugestao { tipo, nome, papel } }` (grava em descricao/tags).
- `kit_sugerir { client_id, imagem_ids[] }` -> propõe kit(s) a partir das fotos (visão), com papéis, atributos observados, invariantes e lacunas; não grava.
- `kit_salvar { client_id, kit (com id para editar), refs: [{ imagem_id, papel, vista, prioridade }] }` -> `{ kit, refs }`.
- `receitas { }` -> as 8 receitas + presets de câmera (de `docs/mesa-foto/pesquisa`, copiados para um arquivo .ts da função) sem IA.
- `ensaio_planejar { client_id, kit_id, receita_id, finalidade, formatos, pedido? }` -> o diretor de fotografia (modelo "diretor_arte" ou estrategista) monta as tomadas com o contexto do cliente (contexto consolidado, marca, história, porquê, público) e as lacunas do kit; cada tomada com modo e o que pode mudar; tomadas que exigem evidência ausente vêm marcadas `bloqueada` com o motivo. Grava `foto_ensaios`. `-> { ensaio, estimativa_usd }`.
- `tomada_gerar { ensaio_id, tomada_id, modelo_imagem_id?, qualidade? }` -> gera UMA versão (fôlego), com as fontes do kit anexadas (identidade primeiro), prompt fotográfico (câmera, luz, cenário, invariantes, proibições), regras por tipo (pessoa, alimento). Refazer = versão nova com variação real. Grava a versão. `-> { ensaio, versao }`.
- `preparar { client_id, imagem_id, modo: 'fundo_branco'|'fundo_transparente'|'cenario'|'luz_cor'|'limpar', areas_protegidas?: Area[], cenario?: string, instrucao? }` -> derivada nova no acervo (modo preservar usa máscara + `devolverOriginalForaDasAreas`/`mascara` de `_shared/imagem-local.ts`). Se o provedor não suporta o que o modo exige, erro explícito (sem cair em modo pior calado). `-> { imagem, custo_usd }`.
- `versao_conferir { ensaio_id, tomada_id, versao }` -> visão compara a versão com as fontes do kit (produto/variante, rótulo e texto, proporção, rosto, mãos, cabelo, ingredientes, reflexos, sombra) -> `{ conferencia: { pontos: [{ criterio, ok, nota }], alertas[] } }`; Jev só como aviso (sem laço).
- `versao_decidir { ensaio_id, tomada_id, versao, decisao: 'aprovar'|'rejeitar', motivo? }` -> aprovar trava a versão e cria/atualiza a derivada em `cliente_imagens` (aprovada=true, gerada, modo, derivada_de, kit_id).
- `enviar { client_id, imagem_ids[], destino: 'arquivos'|'aprovacao' }` -> grava em Arquivos (pasta `base` para fotos do cliente; `materiais` quando for para aprovação, com `requires_approval`) pelo mesmo caminho de `create_file_record` usado no estudio-arte. `-> { file_ids }`.
- `baixar { client_id, imagem_ids[] }` -> URLs assinadas (download em ZIP é feito no front com jszip).
- "Usar na Mesa / Mesa Ads": a foto aprovada já está no acervo (`cliente_imagens`); o front leva para `/mesa?client=..&aba=estudio` ou `/mesa-ads?...` com a foto selecionada via o que o Estúdio já aceita (imagens_ids / fotos_livres). A frente B confere como o Estúdio recebe foto do acervo e usa o mesmo caminho.

## Front (frente B)

Rota `/mesa-foto` (admin, gestor, design), dentro da rota-mãe da casca em `src/App.tsx`, mesmo `MesaContexto`/casca da Mesa (seletor de cliente, carteira, custo). Etapas: **Acervo** (upload em lote grande com arrastar e soltar, filtros original/derivada/gerada/aprovada, leitura por visão, baixar, enviar), **Kits**, **Preparar** (antes/depois, áreas protegidas desenhadas na imagem como no ajuste por área do Estúdio), **Ensaio** (receita, tomadas, câmera por presets em botões, custo), **Revisar** (grade de tomadas com versões, comparação com originais, conferência como aviso, aprovar/rejeitar/refazer), **Usar** (baixar ZIP, Arquivos, aprovação, usar na Mesa/Mesa Ads). Visual premium, poucos cliques, sem poluição, organizado como a Mesa.

## Ads ZIP + MCP (frente C)

- No envio ao gestor (PacoteDaCopy / EnvioAoGestor), botão "Baixar pacote completo (.zip)": gerado no navegador com jszip: `LEIA-ME.md` (como subir no Gerenciador passo a passo), `estrategia.md` (briefing, oferta, objetivo, plano com ângulos, hipóteses, notas do Jev, estrutura de conjuntos, regras de corte/escala), `copies.md` e `copies.csv` (por criativo: textos, títulos, descrições, CTAs, ganchos, destino, UTM), pasta `criativos/` com as imagens finais de cada criativo por formato (nome de arquivo casado com o CSV). Mantém "criar tarefa".
- MCP: ferramentas de leitura para quem vai rodar o tráfego estudar antes: `aceleriq_mesa_ads_contexto { client }` (briefing, ofertas, planos com ângulos, porquês, notas do Jev, criativos com copy/pacote e URL assinada da arte, análises da conta), e `aceleriq_mesa_foto_contexto { client }` (kits, ensaios, fotos aprovadas com URL). Registrar no catálogo de ferramentas, escopos e mapa de áreas (`mcp-tools.ts`), com os testes do MCP.
