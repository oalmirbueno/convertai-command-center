/**
 * imagescript@1.3.0 das funções: a cópia em copias-leves/modulos/imagescript (licença MIT).
 *
 * FN-08 (30/09/2026): o imagescript de deno.land baixava 7 arquivos .wasm com
 * fetch() toda vez que uma função subia (de 2 a 7 s por partida, e a função
 * não subia com deno.land fora do ar). A cópia traz os mesmos .wasm dentro do
 * código e compila cada um só quando aquele formato é usado. Mesmo JS, mesmos
 * bytes de saída (conferido em src/test/fn-imagescript-vendor.test.ts).
 *
 * Toda função importa daqui, nunca de deno.land: uma classe Image só, então
 * `instanceof Image` vale entre os módulos. Quem só lê o cabeçalho usa
 * imagem-cabecalho.ts, e quem abre imagem sob demanda usa imagem-sob-demanda.ts.
 *
 * A cópia (2,4 MB, quase tudo o .wasm em base64) mora na pasta da copias-leves,
 * a função que sempre abre imagem, e não em _shared: a publicação do Lovable
 * leva _shared inteiro para o App MCP e recusa acima de ~4,4 MB
 * (src/test/compartilhados-no-limite-do-lovable.test.ts). Só entra no pacote de
 * quem carrega o imagescript.
 */
export * from "../copias-leves/modulos/imagescript/mod.ts";
