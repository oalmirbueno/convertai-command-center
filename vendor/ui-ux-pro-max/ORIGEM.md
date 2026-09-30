# Origem da base UI UX Pro Max (dado importado, aviso MIT)

Frente UXM, 30/09/2026 (PARTE MESAS do desenho `p10-desenho-uiux.md`).

## Fonte fixa

| Campo | Valor |
|---|---|
| Pacote | `ui-ux-pro-max-cli` no npm (o que o método oficial instala) |
| Versão | `2.15.0` (a `latest` em 30/09/2026) |
| Integridade do pacote | `sha512-D0J/C40xrzzi5si6ZLtRGbEE5v3QjL7d4wJNnasmP3yfDSrGiuqVCdwQiqCNnIkbqOuVoA/uonR2o1WKXh3urw==` |
| `gitHead` | `a38d04c3d5c298c851dbe5e6ee1965ee3de42cb5` |
| Repositório | https://github.com/nextlevelbuilder/ui-ux-pro-max-skill |
| Licença | MIT, "Copyright (c) 2024 Next Level Builder" (arquivo `LICENSE` ao lado; o pacote npm não traz o arquivo, o texto vem do repositório) |

## Como os arquivos chegaram aqui

1. Os 10 arquivos de `data/` foram copiados do clone local do repositório (`C:\AI\acervo-aceleriq\ui-ux-pro-max`, commit `09170ee`, pasta `src/ui-ux-pro-max/data`).
2. Cada um foi conferido, byte a byte, contra a integridade SHA-256 que o registro do npm publica para o mesmo caminho dentro do pacote 2.15.0 (`/assets/data/<arquivo>` na listagem do pacote). Os 10 são iguais. O que muda entre o npm 2.15.0 e o clone `09170ee` são 3 stacks, os scripts Python e o `catalog-summary.json`: nada que as mesas usem.
3. `catalog-summary.json` veio do mesmo clone e serve só de oráculo de contagem no teste (`src/test/uix-base-de-design.test.ts`). As contagens das bases que as mesas usam são as mesmas nas duas versões; os `sha256` que ele traz para `google-fonts.csv` e `google-font-licenses.json` batem com os arquivos daqui.
4. Fim de linha LF em todos (o `.gitattributes` desta pasta fixa `eol=lf`).

## Arquivos e SHA-256 (conteúdo em LF)

| Arquivo | Bytes | SHA-256 | Igual ao npm 2.15.0 |
|---|---:|---|---|
| `styles.csv` | 149478 | `a93a4d9d7025856575d7b7583bda020be9043013432c5af7c58af9dbdfb206b7` | igual |
| `products.csv` | 75623 | `42473f75e8dde5987bdf89ce55d8c168091b80a356cae691dd60247d80720b70` | igual |
| `colors.csv` | 37940 | `8162429222bce22df62b564085946a30d07cc9722c58d0a3a494bd0d1d00841c` | igual |
| `ui-reasoning.csv` | 77360 | `f0774dd741cecdad5eec842034bd6d5e9ea50e9f220a1910069748daa0bb8e9a` | igual |
| `typography.csv` | 49997 | `321fc446e89024488ebae96dda93efc4d2307bd8bddb240857ad51364f6782c8` | igual |
| `landing.csv` | 25449 | `9a2edd3bb676c2a58f00ade7a062e285222d4297bfd847c8d5b056f0dbbf52d0` | igual |
| `ux-guidelines.csv` | 27516 | `ff81ec613f70ba9fc3fcce52dbe4ae35d44b2079dbe6dc066d2d6e38c28facd5` | igual |
| `charts.csv` | 23365 | `4115cf1120680f2cedef0676cb648f30c7ef4699e2a947535d4113e71ed3b12a` | igual |
| `google-fonts.csv` | 747241 | `1c8c3b2ea1faf6a1012da463756def8b3889db33f2226f0343bb4daa80307d03` | igual |
| `google-font-licenses.json` | 433127 | `35688523f2955795caa1a47c53b83099e60c1708461476f9cc3a050cf3b0148a` | igual |

## Quem usa

- Ninguém importa esta pasta em tempo de execução. Ela serve só ao gerador (`node scripts/uiux/importar-base.mjs`) e ao teste de igualdade.
- O gerador escreve `supabase/functions/_shared/uiux/dados/*.ts` (arrays tipados, com o aviso MIT no cabeçalho). Rodar de novo com `--conferir` gera em memória e compara com o disco, sem escrever.
- Os textos da tela e dos agentes (rótulos em português, "como corrigir" das regras de UX, instruções ao Jev) são nossos, em `supabase/functions/_shared/uiux/pt.ts` e nos demais arquivos escritos à mão.

## Trocar de versão

É trabalho de frente: substituir os CSV aqui, rodar o gerador, rodar o teste (ele mostra o que mudou: contagens, SHA-256, ids de citação `uupm:<base>:<id>`) e revisar os textos à mão que dependem dos ids.
