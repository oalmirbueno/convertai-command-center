# Mesa Foto v2: diretor que trabalha, produto pela embalagem, variações e campanha

Data: 2026-09-24. Continuação de `docs/mesa-foto/CONTRATO.md` (regras duras continuam valendo).

## O que o dono viu no primeiro uso

1. Mandou duas fotos de caixas de mouse NTC e disse "malas" (ditado). O diretor recusou: "a caixa não é evidência suficiente, envie fotos do mouse fora da caixa". O dono quer o contrário: **identificar o produto pela embalagem** (marca, modelo, variante lidos na caixa), **pesquisar na internet** o produto real (fotos oficiais, especificações), montar o kit com essas referências e **criar o produto fora da caixa de forma fiel**; se não der, trabalhar com a embalagem. Palavra que não bate com a foto (ex.: "malas" com caixa de mouse na imagem) = o diretor diz o que entendeu ("vi caixas do mouse NTC X, vou trabalhar com ele") e SEGUE, sem travar.
2. O kit que o diretor montou **sumiu** (não ficou persistente). Kit sugerido tem que virar kit salvo (rascunho) e aparecer na lista, no seletor da barra e no Preparar/Ensaio.
3. Quer pedir ao diretor **quantas variações e de que tipo** (ex.: 8 variações: herói em fundo de cor, lifestyle na mesa, na mão, flat lay com props, macro de detalhe, cenário da marca...) e gerar todas de uma vez, com custo total antes. Hoje "está confuso, meio burro, uma linha".
4. **Campanha com modelo (publicidade)**: ex. ótica. Mandou o perfil @zerezes como referência de pegada: fotografia editorial de óculos, modelos diversos usando o óculos, céu azul com nuvens, formas prateadas surreais, luz de estúdio azul, retratos de perto, lifestyle na rua, produto flutuando. Quer: escolher o produto (kit), subir uma referência de estilo (print de perfil, moodboard), e gerar várias fotos profissionais de uma **pessoa sintética** usando o produto em ambientes que complementem a identidade do cliente, para humanizar o perfil e fazer campanha. Depois virá uma "Mesa de Publicidade" completa (o dono manda a base depois); agora é uma aba **Campanha** dentro da Mesa Foto, organizada para crescer.

## Regras novas

- Proativo: o diretor sempre propõe o próximo passo concreto e executável; só pergunta quando falta algo que muda o resultado, e mesmo assim oferece um caminho padrão.
- Referência da web: fotos oficiais/lojas do produto entram no kit como `papel: 'identidade'` com `origem_web: { url, fonte, pagina }` e marca "referência da internet, uso interno para fidelidade, não publicar". Nunca vão ao cliente como foto final. Se a web não confirmar o modelo, a lacuna fica escrita e o diretor avisa.
- Pessoa sintética: nunca parecida com pessoa real conhecida; diversidade de perfis; sem sexualização; sem menor de idade; marcada `gerada`. O produto do kit é invariante (formato da armação, cor, ponte, hastes, lentes).
- Referência de estilo (print de perfil): o diretor extrai a DIREÇÃO (paleta, luz, enquadramento, cenários, props, clima) num "guia de estilo da campanha"; nunca copia foto, marca ou pessoa.
- Sem laço de correção; custo total antes de gerar em lote; gerar em lote = uma chamada por foto, com andamento, e para quem sair da aba o que já foi gerado fica salvo.

## Servidor (`mesa-foto`)

- `produto_identificar { client_id, imagem_ids[] }` -> visão lê a embalagem/foto (marca, modelo, variante, códigos, texto), depois **pesquisa web** (motor com `pesquisaWeb: true`, timeout 300 s) pelo produto real: página oficial, especificações, imagens (URLs de imagem de produto: og:image, imagens da página oficial ou de lojas grandes). Baixa até 6 imagens de referência para `mesa/<cliente>/foto/web/...` (só https público, tipo validado, proteção de host interno). `-> { produto: { marca, modelo, variante, categoria, especificacoes[], confianca, evidencias[] }, referencias_web: [{ imagem_id, url_origem, pagina, fonte }], lacunas[], proximo_passo }`. As imagens baixadas entram em `cliente_imagens` (origem 'mesa_foto', tags ['referencia_web'], descricao com a fonte) para poderem entrar no kit.
- `kit_sugerir` passa a **salvar** os kits sugeridos como rascunho (e devolve os ids), com as referências web quando `produto_identificar` rodou. Se já houver kit rascunho do mesmo produto, atualiza em vez de duplicar.
- Diretor (`agente_conversar`): novo sistema proativo (regras acima), entende pedido de variações e campanha, sabe usar `produto_identificar`, e devolve sugestões com tipos novos: `plano_de_variacoes { kit_id, quantidade, variacoes: [{ nome, tipo, camera, cenario, luz, props, formato }] }`, `campanha { kit_id, guia_de_estilo, modelo {perfil, idade_aprox, estilo}, fotos: [...] }`, `identificar_produto { imagem_ids }`. `agente_aplicar` cria o ensaio correspondente (tomadas prontas) e devolve `{ ensaio, estimativa_usd }`.
- `variacoes_planejar { client_id, kit_id, quantidade (1 a 16), tipos?[], pedido?, referencia_ids? }` -> ensaio com N tomadas realmente diferentes (herói fundo de cor, fundo branco, lifestyle, na mão, flat lay, macro, cenário da marca, produto flutuando, fora da caixa, com embalagem...), cada uma com câmera/cenário/luz; `-> { ensaio, estimativa_usd }`.
- `campanha_planejar { client_id, kit_id, quantidade (1 a 16), referencias_estilo_ids? (prints/moodboard do acervo ou biblioteca), modelo?: { perfil?, idade_aprox?, estilo? }, pedido? }` -> lê as referências de estilo por visão e gera o `guia_de_estilo` (paleta, luz, cenários, props, enquadramentos, clima) + tomadas de campanha com pessoa sintética usando o produto; grava em `foto_ensaios` com `receita_id: 'campanha-com-modelo'` e `direcao.guia_de_estilo`. `-> { ensaio, guia_de_estilo, estimativa_usd }`.
- `tomada_gerar` entende tomadas de campanha (pessoa sintética + produto do kit como identidade + referências de estilo só como estilo) e de "fora da caixa" (produto recriado a partir das referências web/fotos do produto, nunca da arte da caixa).
- Receitas: acrescentar `campanha-com-modelo` e `fora-da-embalagem` em `receitas.ts`.

## Tela

- **Kits**: botão "Identificar produto pela embalagem ou foto" (mostra marca/modelo/variante, especificações, as referências da internet com a fonte, e confirma); kits sugeridos já aparecem salvos; kit ativo na barra persiste (URL).
- **Diretor**: resposta mais útil e organizada (não "uma linha"): cartões de plano de variações com seletor de quantidade e tipos, "Gerar todas (N fotos, ~US$ X)"; cartão de campanha com o guia de estilo; atalhos: "Identificar produto", "Tirar da caixa", "8 variações", "Campanha com modelo".
- **Nova aba "Campanha"** (entre Ensaio e Revisar, ou onde ficar mais claro): escolher o produto (kit), subir/escolher referências de estilo (print de perfil, moodboard, biblioteca), perfil do modelo sintético, quantidade, ver o guia de estilo, gerar em lote com andamento, revisar e usar (mesmo fluxo de aprovação). Organizada para virar a futura Mesa de Publicidade.
- Gerar em lote: botão com total, uma por vez, andamento por foto, dá para sair e voltar.
