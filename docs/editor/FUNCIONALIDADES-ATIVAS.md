# Editor de vídeo (Mesa Edição): o que está ativo de verdade

Conferido em 02/10/2026 no código e nos testes (vitest); revisado no mesmo dia com o agente que edita completo (seção 1). Legenda:

- **Ativo**: roda na tela, sem depender de nada fora do navegador (desfaz com Ctrl+Z).
- **Ativo (servidor)**: precisa da função publicada (editor-video ou mesa-videos) ou do worker de render. Sem ela, a tela diz "em preparação" ou usa a regra da casa; nada finge que fez.
- Testes entre parênteses (pasta `src/test/`).

## 1. Agente editor (lateral fixa e coluna do editor)

| Funcionalidade | Estado |
| --- | --- |
| Pedido livre ao modelo escolhido (custo antes, teto por pedido, até 10 passos e 30 ferramentas) | Ativo (servidor: `agente_passo`) (ag2-editor, editor-de-video) |
| Resposta final feita pelo CÓDIGO: o que mudou de verdade (antes e depois, contado), o que não entrou e a pergunta; o texto do modelo que afirma ou promete sem ter feito nunca aparece | Ativo (editor-agente-edita-completo, editor-agente-edita-completo-tela) |
| Laço que confere: cada ferramenta que muda volta com "Conferido" (o que entrou); "terminei" com ferramenta que falhou ganha mais um passo para corrigir; pedido de edição sem mudança ganha um lembrete | Ativo (editor-agente-edita-completo) |
| Edição completa (EDIT IA PRO) pelo agente: `edicao_completa` roda o motor inteiro (erros e pausas, ritmo do Brabo, legenda na cor da marca, zoom nos momentos, animações, B-roll do acervo, transições, cor, música do acervo com ducking, sons, cartão final) num passo do Ctrl+Z; o agente ajusta o plano (receita, legenda, cor, gancho, música) | Ativo (servidor: Jev para momentos, B-roll e animações; sem ele, a regra da casa) (editor-agente-edita-completo) |
| "Edita completo e dinâmico" que o modelo não editou: a regra da casa roda o EDIT IA PRO sozinha | Ativo (editor-agente-edita-completo) |
| Atalho "Edição completa": EDIT IA PRO sem modelo (plano da casa), na hora, com Desfazer | Ativo (editor-agente-edita-completo-tela) |
| Entendimento do vídeo em todo passo (código, sem custo): tipo, seções, pausas, ênfases, dados ditos (número, preço, lista), perguntas, rosto e o que já está montado; `entender_video` mostra inteiro | Ativo (editor-agente-edita-completo) |
| Copiar a edição de uma referência medida (`aplicar_referencia`, r1, r2, com a fidelidade) | Ativo (editor-agente-edita-completo) |
| Editar texto, legenda, cena e os parâmetros de uma peça de motion (`editar_clipe`; parâmetro inválido não grava) | Ativo (editor-agente-edita-completo) |
| Transição num clipe ou em todos, mixagem (dB abaixo da voz, subida nas pausas, ducking, LUFS), música do acervo pelo m1 | Ativo (editor-agente-edita-completo) |
| Começar do zero: `cena` (fundo liso ou degradê, título, peça), texto, motion com tempo, mídia, música, B-roll gerado | Ativo (editor-agente-edita-completo) |
| Trocar cenário e painéis pagos (Timestamp, rosto, gerar, LUT, ler referência): o agente abre o painel já preenchido; o custo aparece lá antes de gerar | Ativo (editor-agente-edita-completo-tela) |
| Pesquisar na web com fontes (`pesquisar`), dentro do teto do pedido | Ativo (servidor: `agente_pesquisar`) |
| Mapa de cobertura: toda capacidade da tela tem ferramenta do agente (src/lib/editor/capacidades.ts) | Ativo (editor-agente-edita-completo) |
| Apelidos fixos no pedido inteiro (c3 é o mesmo c3 do começo ao fim) | Ativo (editor-agente-edita-de-verdade) |
| Tirar um ou vários clipes (`remover` com `clipes`), com ou sem puxar o resto | Ativo (editor-agente-edita-de-verdade) |
| Tirar takes repetidos (`remover_duplicados`: mesma mídia e mesmo trecho; fica o primeiro) | Ativo (editor-agente-edita-de-verdade) |
| "Remova os takes duplicados" sem modelo e sem custo; "tem take duplicado?" mostra e pede Confirmar | Ativo (editor-agente-edita-de-verdade) |
| Mover (inclusive para outra trilha), aparar, dividir, recortar trecho da fonte, reordenar | Ativo (editor-de-video, ag2-editor) |
| Fechar buracos, ajustar velocidade, volume, zoom e nota | Ativo (editor-de-video) |
| Buscar (filtra a Mídia e a linha do tempo na tela do dono) | Ativo (editor-agente-edita-de-verdade) |
| Pôr mídia da Mídia na linha do tempo (`inserir_midia` com m1, m2) | Ativo (editor-agente-edita-de-verdade) |
| Texto na tela, legenda (blocos de N palavras), formato, cor, efeito num trecho, animação na palavra dita, música, logo, cartão final | Ativo (editor-edt-render-motion-agente) |
| Todas as skills pelo `aplicar_skill` | Ativo (editor-de-video) |
| Zoom nos momentos fortes, capítulos, sugerir animações | Ativo (servidor: Jev; sem ele, a regra da casa) |
| Medir a onda, amostra de 8 a 15 s, render do vídeo inteiro | Ativo (servidor e worker de render) |
| B-roll e elemento gerados (pagos: cartão com o custo antes) | Ativo (servidor: mesa-videos e `elemento_gerar`) |
| Ordem clara vai na hora (um passo do Ctrl+Z, com Desfazer); dúvida, recusa ou parada pedem Confirmar; ferramenta que falhou não trava o resto (é dita na resposta) | Ativo (ag2-editor) |
| Sem resposta do Jev: a regra do verbo decide ("apague o c3" vai; "será que tiro?" pergunta) | Ativo (editor-agente-edita-de-verdade) |
| "O que mudei" dito pelo código com os apelidos ("Mudei: Tirei c5, c3.") | Ativo (editor-agente-edita-de-verdade) |
| O que o agente mexeu brilha na linha do tempo por 6 s | Ativo |
| Cartão com muitos itens mostra 6 e "Ver os N itens" | Ativo |
| Conversa guardada na versão, volta ao reabrir com os cartões no estado certo | Ativo (servidor: `conversa_ler`, `conversa_gravar`) (ag2-editor) |
| Seleção e cursor viram "esse" e "aqui"; pergunta com opções vira botões | Ativo (ag2-editor) |
| Assistir o vídeo (quadros para um modelo com imagem) | Ativo (servidor: `visao_descrever`) |
| Atalhos: Edição completa, Ritmo do Brabo, Cortar silêncios, Legendas, Punch-in, Tirar repetidos | Ativo |
| Aprendizado (Aprendi / Segui) | Ativo (servidor) |

## 2. Linha do tempo

| Funcionalidade | Estado |
| --- | --- |
| Arrastar para mover (inclusive para outra trilha compatível), puxar a borda para aparar, ímã a 8 px | Ativo (editor-quadros-e-linha-leves) |
| Seleção (clique; Ctrl ou Shift soma), S divide, Delete tira (Shift puxa o resto) | Ativo (editor-de-video-tela) |
| Desfazer e refazer (Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y), salvamento automático com revisão | Ativo (editor-de-video-tela) |
| Zoom (botões, régua, Ctrl + roda), Caber, régua com capítulos e momentos virais | Ativo |
| Som e visibilidade por trilha | Ativo |
| Miniaturas dos clipes (só as visíveis, fila que cancela) | Ativo (editor-quadros-e-linha-leves) |
| Busca com filtros: o que não bate fica apagado, "Só repetidos", Escolher os achados | Ativo (editor-busca-skills-tela-cheia) |
| Linha com mais de 100 clipes desenha só a parte visível | Ativo (editor-busca-skills-tela-cheia) |

## 3. Mídia

| Funcionalidade | Estado |
| --- | --- |
| Lista dos vídeos, imagens e áudios do cliente e do que as gerações devolveram | Ativo |
| Busca com filtros: tipo, origem (bruto, gerado, acervo), uso na linha do tempo, duração, só repetidos (sha256) | Ativo (editor-busca-skills-tela-cheia) |
| Pôr no cursor (empurra o resto) e no fim; "na linha" no que já está em uso | Ativo |
| Virar clipe a partir de imagem (abre Gerar) | Ativo (servidor: mesa-videos) |
| Lista longa em blocos de 60 (Mostrar mais) | Ativo |

## 4. Skills (todas são regra fixa, sem IA, de graça)

Busca, grupos pelo objetivo, uma linha do que faz e um botão Aplicar. A proposta aparece embaixo da skill (mudanças, duração antes e depois, lista recolhida) com Confirmar, Cancelar e depois Desfazer (editor-busca-skills-tela-cheia, editor-de-video-tela).

- Cortar e limpar: Edição dinâmica (Brabo), Cortar pela onda, Ficar com a melhor tomada, Cortar silêncios, Tirar takes repetidos, Fechar buracos.
- Ordem e transições: Organizar por roteiro, Transições suaves, Antes e depois.
- Legenda e som: Legendas, Efeitos sonoros.
- Imagem e ritmo: Punch-in, Zoom nos momentos, Reenquadrar, Cor.

As que precisam da fala aparecem com "sem fala" até o Timestamp marcar.

## 5. Painéis do trilho

| Painel | Estado |
| --- | --- |
| Editar com IA: Plano da casa (grátis) e Montar a edição com Confirmar | Ativo (editor-edt2-tela) |
| Editar com IA: Planejar com o modelo | Ativo (servidor: `edicao_planejar`) |
| Corte: skills de corte | Ativo |
| Legendas e textos: estilo da marca, posição, texto no cursor (10 estilos de legenda, 9 de texto) | Ativo |
| Motion: 13 peças no cursor, logo (abertura, canto, fim) | Ativo |
| Motion: polaroide com a foto escolhida da mídia do projeto | Ativo (corrigido em 02/10; antes saía um quadro cinza) |
| Motion: Sugerir na fala (IA) | Ativo (servidor: `animacoes_sugerir`) |
| Zoom e efeitos: efeito no cursor, skills de ritmo | Ativo |
| Zoom e efeitos: zoom nos momentos fortes (IA) | Ativo (servidor: Jev; sem ele, a regra) |
| Cor: looks, 7 ajustes, LUT .cube, cor só num trecho | Ativo (editor-edt2-tela) |
| Formato: 9:16, 1:1, 4:5, 16:9 seguindo o rosto | Ativo |
| Formato: rastrear o rosto | Ativo (servidor: `rosto_rastrear`) |
| Som: música da Mídia ou do acervo com ducking, mixagem, efeitos no cursor | Ativo |
| Capítulos e virais: achar capítulos e momentos, copiar para o YouTube | Ativo (servidor: `capitulos_sugerir`, `momentos_avaliar`) |
| Capítulos e virais: criar corte 9:16 | Ativo (servidor: `versao_registrar`) |
| Exportar: render em vários formatos, amostra de 12 s, .srt e capítulos | Ativo (servidor e worker) (editor-edt2-tela) |
| Gerar: câmera, continuar, transição, cena a partir de imagem (custo antes) | Ativo (servidor: mesa-videos). O resultado vai para a Mídia, não sozinho para a linha do tempo |
| Trocar cenário: amostra, final e entrada sozinha na linha do tempo | Ativo (servidor: `cenario_*` e máquina de render) (troca-de-cenario) |
| Timestamp: transcrever ou alinhar (pago), fala da Entrada (grátis) | Ativo (servidor: `timestamp_parte`, `alinhar_*`) |
| Referências: link, mídia ou arquivo, medir, ler a edição, aplicar, templates | Ativo (servidor: `receita_*`, tabela `video_receitas`) |
| Ajustes (Inspector): tempos, texto, velocidade, volume, zoom, transições, antes e depois, nota, comparar | Ativo (editor-de-video-tela) |
| Ajustes (Inspector): parâmetros da peça de motion campo por campo e fundo da cena do zero | Ativo (sem teste de tela) |
| Começar do zero (versão vazia no Editar, também sem vídeo na Entrada) | Ativo (servidor: `versao_registrar` da mesa-videos, já publicado) |

## 6. Prévia e tela cheia

| Funcionalidade | Estado |
| --- | --- |
| Player com a composição do projeto, J, K, L, espaço, setas, Home e End | Ativo |
| Ampliar (esconde as laterais; Esc volta) | Ativo |
| Tela cheia: editor, linha do tempo, ferramentas e o agente da lateral na tela inteira, sem o menu do painel | Ativo (editor-busca-skills-tela-cheia) |
| Só o vídeo: o player sozinho, agora com controles (dois cliques no vídeo também) | Ativo |
| Relógio da prévia isolado (só ele redesenha a cada quadro) | Ativo |

## 7. O que foi corrigido ou continua com limite (auditoria 02/10)

- Corrigido (02/10, tarde): o agente "alucinava" (a resposta era o texto do modelo, mesmo sem mudança), não tinha o motor (o sistema mandava sugerir o painel Editar com IA e todo "edita" virava só a skill de ritmo), faltavam ferramentas (referência, transição, mixagem, peça, cena, cenário, pesquisa), o contexto não entendia o vídeo, o laço parava no "terminei" com falha e uma falha mandava tudo para o Confirmar.
- Corrigido: o agente não tirava os takes repetidos (apelidos que mudavam no meio do pedido; skill sem nada a mudar contava como falha; "takes repetidos" caía na skill de fala; sem Jev tudo virava Confirmar).
- Corrigido: polaroide sem foto; "Parar" que não parava em Referências (agora só aparece na medição); "Lado a lado" agora diz que compara com o clipe bruto.
- Limite: o resultado de Gerar (câmera, continuar, transição, cena) chega na Mídia; pôr na linha do tempo é um clique (ou o agente com `inserir_midia`).
- Limite: o aviso do Exportar sobre a máquina usa a última leitura do estado da máquina.
- Limite: a cena do zero (fundo) e a peça editada aparecem na prévia na hora; o render da nuvem desenha a cena só depois de publicar o pacote de render novo (Composicao.tsx mudou).
- Limite: pesquisar usa o modelo escolhido no agente (precisa aceitar busca na web) e cobra a busca dentro do teto do pedido.
- Sem teste de tela ainda: Formato, Zoom, Textos, Som, Motion, Capítulos, Troca de cenário, Referências, Gerar e Timestamp (a lógica deles tem teste; a tela não).
