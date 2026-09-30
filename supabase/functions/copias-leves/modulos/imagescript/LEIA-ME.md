# imagescript 1.3.0 (cópia local)

Cópia do [imagescript](https://deno.land/x/imagescript@1.3.0) usada pelas Edge Functions.
Licença dupla do autor (AGPL-3.0-or-later OU MIT, arquivo `LICENSE`); usamos a MIT (`LICENSE.MIT`).

## Por que existe (FN-08, 30/09/2026)

O imagescript de deno.land baixa 7 arquivos `.wasm` com `fetch()` toda vez que a função sobe.
Nos logs de 29/09 isso custava cerca de 2 s em cada chamada (inclusive no OPTIONS do navegador)
e, com deno.land fora do ar, as funções de imagem não subiam. Medido no Deno local:
importar de deno.land levou de 3,4 a 5,2 s (7 downloads); esta cópia, de 54 a 233 ms (nenhum download).

## O que mudou em relação ao original

- Todo o JS é o original, byte a byte (SHA-256 conferido contra o `deno.lock` do repositório).
- Só os 7 carregadores `utils/wasm/{svg,gif,png,font,jpeg,tiff,zlib}.js` mudaram: o bloco que fazia
  `fetch(import.meta.url...)` saiu, e o `.wasm` vem de `./<nome>.wasm.js` (base64) e é compilado
  na primeira vez que aquele formato é usado. Quem só lê JPEG e PNG não compila SVG, fonte, TIFF nem GIF. SVG e TIFF ficam fora da cópia (nenhuma função usa; o pacote do estudio-arte passava dos 5 MB de deploy): usar um deles dá erro claro.
- `utils/wasm/base64.js` é nosso: base64 para bytes com `atob`.
- Os bytes de saída são os mesmos do original (JPEG 85, PNG, decodificação e redução conferidos em
  `supabase/functions/_shared/imagescript_test.ts`).

## Como usar

Importe de `supabase/functions/_shared/imagescript.ts` (nunca de deno.land e nunca desta pasta direto).
A cópia mora aqui, na pasta da copias-leves, e não em `_shared`: a publicação do Lovable leva `_shared`
inteiro para o App MCP e recusa acima de ~4,4 MB.
Quem só precisa do cabeçalho usa `_shared/imagem-cabecalho.ts`; quem abre imagem sob demanda usa
`_shared/imagem-sob-demanda.ts` (FN-01: a função não carrega o imagescript na partida).

## Como gerar de novo

```
node scripts/gerar-imagescript-vendor.mjs
```

O script baixa os arquivos de deno.land, confere o SHA-256 de cada um e reescreve esta pasta.
