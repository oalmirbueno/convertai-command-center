# Catálogo de mockups (máquina da agência)

O painel compõe os mockups no navegador. Aqui ficam as ferramentas que preparam o catálogo, uma vez por mockup.

## De onde vêm os mockups

1. **PSDs dos pacotes da agência**
   - `extrair.py <selecao.json>`: tira dos zips só os PSDs do lote.
   - `processar_lote.py <selecoes...>`: roda o `psd_mockup.py` em cada PSD (passadas preto, branco e vazio, mais o controle de qualidade contra a prévia do Photoshop).
   - `calibrar.py`: tenta recuperar os reprovados.
     - Fora do slot, a prévia do Photoshop vira a verdade (sombra, reflexo e luz do cenário).
     - Dentro do slot, entra uma correção de cor por canal com um campo de luz suave.
     - A correção é ajustada em metade dos pixels e medida na outra metade.
     - Só volta ao catálogo o que fica dentro do limite 3,0 nessa medida.
     - O original fica em `_antes_da_calibracao/`.
   - `processar_lote.py <selecoes...> --so-catalogo`: remonta o `catalogo.json` depois da calibração.
   - Passe sempre todas as seleções (`selecao_lote1.json`, `selecao_lote1b.json`, `selecao_lote2.json`, `selecao_lote3.json`): o `catalogo.json` sai só das seleções passadas.
   - O lote 3 (`selecao_lote3.json`) busca o que falta para a identidade: canecas (matte_mug 2 a 5), sacolas (Sacola/01), camisetas com mapa de displace, logo com efeito e revistas. Em `papeis`, a alça da caneca é slot de cor.
   - Curadoria na seleção: `papeis` (papel de cada slot), `areas` (área segura marcada à mão, ex.: o peito da camiseta), `esconder` (regex de camadas que não podem ir para o cliente, como a dica do vendedor ou a cor fixa da camiseta) e `fora` (motivo para ficar fora).
   - Com `esconder`, o controle de qualidade compara com a prévia como o vendedor gravou; as camadas que sobem saem sem as camadas escondidas.
2. **Mockups feitos com IA**
   - `cenas-de-ia.mjs`: a lista de cenas.
     - Cada cena tem uma superfície lisa e branca.
     - As de estúdio vêm em croma verde, para o fundo trocável.
   - `gerar_cenas_ia.mjs`: gera as cenas com a chave `OPENROUTER_API_KEY` do processo (nunca em arquivo).
     - Cena já gerada é pulada.
     - Custa cerca de US$ 0,04 por cena (GPT Image 2.5 Flare, qualidade alta).
   - `mockup_de_ia.py`: acha os 4 cantos e grava as mesmas camadas dos PSDs.
     - Onde a área certa não é a maior área branca, os cantos vêm de `quads-ia.json`.
     - Nas cenas de estúdio, grava também o `fundo.png` (objeto e sombra).
     - Saída: `catalogo-ia.json`.
     - Confira o `qc.jpg` de cada um: o xadrez mostra a perspectiva.
   - Recorte sem filete branco (rodada 3):
     - cada aresta do quad vai até a borda real da peça (o ponto de maior gradiente numa faixa para fora); aresta sem borda clara vai 1,5% para fora;
     - a área branca cresce até essa aresta pelo watershed, só para fora (alça e dedo por cima da peça continuam de fora), e quem desenha a beirada é o polígono, reto e antisserrilhado;
     - nas cenas de croma, o alfa sai da chave linear contra o verde local, a borda é descontaminada (cor do objeto sem o verde misturado) e o verde que sobra é tirado; a arte nunca passa do objeto;
     - a luz do fundo é medida só no fundo, e a sombra de contato fica um pouco mais funda (o verde rebate luz e clareia a sombra).

## Subir para o painel (só depois da migration `20260930322000_mockups_mais_modelos.sql`)

```
node tools/mockups/subir_catalogo.mjs --seco     # confere o que sobe
node tools/mockups/subir_catalogo.mjs            # sobe catalogo.json + catalogo-ia.json
```

A chave de serviço vem de `SUPABASE_SERVICE_ROLE_KEY` ou do Supabase CLI autenticado. O envio é idempotente (upsert pelo id).

**Curadoria (`curadoria-catalogo.json`)**: vista repetida do mesmo pacote (tablet, telas de outdoor, iPhone, notebooks escuros) sobe com `ativo=false`. Fica guardada e volta tirando o id da lista. Assim a sugestão do Jev não fica dominada por telas.

## Licença

O estúdio é ferramenta interna da agência: o cliente recebe só a imagem final, depois da aprovação.

- Ficam fora: GFXTRA/GFXDAY, a Lata (uso não comercial), flats antigos e telas web.
- A origem de cada mockup fica gravada na coluna `origem`.
- As cenas de IA são geradas pela agência.
