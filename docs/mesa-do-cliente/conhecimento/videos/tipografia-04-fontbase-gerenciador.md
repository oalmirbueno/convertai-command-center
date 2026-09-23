# Tipografia 04: FontBase, gerenciar e testar fontes

- Título no YouTube: "Tipografia à vida: O Fontbase"
- Canal: Cursos Thiago - Aulas
- URL: https://youtu.be/64HqEzhkK3g
- Duração: 14:16
- Fonte do resumo: legenda automática em português + quadros a cada 30 s (site fontba.se, interface do FontBase e teste no Photoshop)

## Ideias principais
- **Por que um gerenciador**: muitas fontes instaladas deixam o computador e os programas lentos (a janela de fontes do Photoshop demora a abrir). Mantenha instaladas só as de uso diário; o resto fica guardado e é ativado quando preciso.
- **Ativar e desativar em tempo real**: no FontBase você ativa uma família ou só um estilo (ex.: só o Regular), usa no Photoshop/Illustrator e desativa depois. O programa reconhece na hora; ao desativar, o documento avisa que a fonte sumiu.
- **Instalação por pasta**: o FontBase recebe pastas (de preferência uma pasta por família com todos os pesos). Dá para arrastar uma pasta com várias famílias dentro.
- **Teste de texto**: com uma pasta selecionada, apertar Enter abre uma caixa de texto; o que você digita aparece renderizado em todas as fontes da pasta. Uso principal: testar o nome de uma marca (exemplo "Lenovo") em dezenas de fontes para escolher a do logotipo. Também dá para mudar o tamanho da amostra.
- **Coleções**: agrupar fontes por categoria (serifadas, comic etc.) sem tirá-las da pasta original. Uma fonte pode estar em mais de uma coleção. Ajuda a achar rápido "todas as serifadas que eu tenho".
- **Multiplataforma**: funciona em Windows e Mac, e as coleções podem ser levadas entre máquinas.
- Dica extra: dá para remover fontes do sistema que não são necessárias, conferindo antes quais o Windows exige.

## Exemplos visuais e o que ensinam
- Página "Font management. Perfected." do FontBase com a amostra "The quick brown fox jumps over the lazy dog" em vários estilos: mostra a lógica de comparar fontes com o mesmo texto.
- Lista de estilos de uma família aberta em "detalhes": cada peso como item separado, com ativação individual.
- Mapa de caracteres (glifos) de uma fonte.
- Photoshop com "Lorem Ipsum" e "Thiago" em quadrado azul marinho mudando de fonte ao ativar: prova do tempo real.
- Pasta "Fonts Mac" com dezenas de fontes script e brush testadas com a mesma frase.

## Aplicação no card 4:5 (1080x1350)
- O equivalente do FontBase na Mesa do Cliente é a biblioteca `cliente_fontes` com amostra PNG gerada no navegador. A lição é a mesma: **escolher fonte comparando o texto real do card, não o alfabeto de exemplo**.
- A amostra enviada ao gerador deve ter o texto do título real (ou palavras com acentos do português: "ção", "ã", "é") no peso que será usado, para o gerador copiar o desenho certo.
- Organizar a biblioteca por papel e por coleção (título, texto, destaque; serifada, sem serifa, script, display) facilita o diretor de arte escolher sem ler arquivo por arquivo.
- Manter a biblioteca de cada cliente enxuta (a regra de 5 a 10 coringas vale por cliente: 2 ou 3 fontes da marca + 2 ou 3 alternativas aprovadas).
- Ao escrever o prompt, referir-se à fonte pela amostra anexada ("match the letterforms of the attached font sample named X") em vez de confiar só no nome, porque o gerador pode não conhecer a fonte pelo nome.
