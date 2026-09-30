#!/usr/bin/env node
/**
 * Gera supabase/functions/copias-leves/modulos/imagescript a partir do
 * imagescript@1.3.0 publicado em deno.land (licença dupla AGPL-3.0-or-later
 * OU MIT; usamos a MIT, ver LICENSE.MIT).
 *
 * Por que existe (FN-08, 30/09/2026): o imagescript de deno.land baixa 7
 * arquivos .wasm com fetch() toda vez que uma função sobe (cerca de 2 s por
 * chamada, e a função cai se deno.land estiver fora). A cópia daqui traz os
 * mesmos .wasm dentro de módulos JS (base64) e só compila cada um quando
 * aquele formato é usado pela primeira vez.
 *
 * O JS do imagescript é copiado byte a byte. Só mudam os 7 carregadores
 * utils/wasm/{svg,gif,png,font,jpeg,tiff,zlib}.js: o bloco que fazia fetch
 * sai e o módulo passa a vir de ./<nome>.wasm.js na primeira instância.
 * Todo arquivo lido é conferido por SHA-256 antes de ser escrito.
 *
 * Uso: node scripts/gerar-imagescript-vendor.mjs [--de <pasta com a cópia baixada>]
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://deno.land/x/imagescript@1.3.0/";
// Mora na pasta da copias-leves (a função que sempre abre imagem) e não em _shared: a publicação do
// Lovable leva _shared inteiro para o App MCP e recusa acima de ~4,4 MB (src/test/compartilhados-no-limite-do-lovable.test.ts).
const DESTINO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "functions", "copias-leves", "modulos", "imagescript");

/** SHA-256 dos arquivos originais (os .js/.mjs/.ts batem com o deno.lock do repositório). */
export const ORIGINAIS = {
  "ImageScript.js": "cf90773c966031edd781ed176c598f7ed495e7694cd9b86c986d2d97f783cca0",
  "mod.ts": "18a6cb83c55e690c873505f6fe867364c678afb64934fe7aef593a6b92f79995",
  "png/src/crc.mjs": "5cf50de181d61dd00e66a240d811018ba5070afa8bba302f393604404604de84",
  "png/src/mem.mjs": "4968d400dae069b4bf0ef4767c1802fd2cc7d15d90eda4cfadf5b4cd19b96c6d",
  "png/src/png.mjs": "96ef0ceff1b5a6cd9304749e5f187b4ab238509fb5f9a8be8ee934240271ed8d",
  "png/src/zlib.mjs": "9867dc3fab1d31b664f9344b0d7e977f493d9c912a76c760d012ed2b89f7061c",
  "utils/buffer.js": "952cb1beb8827e50a493a5d1f29a4845e8c648789406d389dd51f51205ba02d8",
  "utils/crc32.js": "573d6222b3605890714ebc374e687ec2aa3e9a949223ea199483e47ca4864f7d",
  "utils/png.js": "fbed9117e0a70602645d70df9c103ff6e79c03e987bd5c1685dcb4200729b6de",
  "utils/wasm/font.js": "9e75d842608c057045698d6a7cdf5ffd27241b5cdea0391c89a1917b31294524",
  "utils/wasm/gif.js": "8b86f7b96486bb8ff50fbc7c7487f86cb5cef85e6acd71e1def78a1aa2f12e4f",
  "utils/wasm/jpeg.js": "75295e2fcf96b4f7bb894b3844fdaa8140d63169d28b466b5d5be89d59a7b6e6",
  "utils/wasm/png.js": "0659536a8dd8f892c8346e268b2754b4414fad0ec1e9794dfcde1ba1c804ee02",
  "utils/wasm/svg.js": "f5c8a9d1977b51a7c07549ceb6bbbaca9497321a193f28b3dc229a42d91bcf14",
  "utils/wasm/tiff.js": "c2d7bdaef094df25aae1752e75167f485e89275d76a1379e39d8949580b7af4f",
  "utils/wasm/zlib.js": "749875f83abffe24d3b977475a0cbd5f9b52bee1fbdbef61ec183cbfc17805f6",
  "v2/framebuffer.mjs": "add44ff184636659714b3c6d4b896f628545451abffbc30b5bcc2e8d9a73d012",
  "v2/ops/blur.mjs": "80716f1ffab8a2aeb54a036f583bf51a2b9dd37e005adc000add803df8e8a12f",
  "v2/ops/color.mjs": "5e72cdcbf97dc939a2795223f01e3cb0544c0c56b03ea2aa026050df58348814",
  "v2/ops/crop.mjs": "69431fa6f687fd9f0c31eff0ec27d7ac925275005e53a37f0c3fab4cc4d9a9ea",
  "v2/ops/fill.mjs": "cf1b9488314753fbc9ebf03410ac74c2a34ea5a69fb6892cd6e8366cd1930d93",
  "v2/ops/flip.mjs": "825a34a66567dcf15e76a719f1bf2f66fb106503cd69942292b1b0ae05c5718e",
  "v2/ops/index.mjs": "423ba687119be2bba8cec72890577d3afa3621b6b8108912242fe937a183f2aa",
  "v2/ops/iterator.mjs": "c2adf3d90ce00719a02c48c97634574176a3501ff026676259bd71aa8f5d69b9",
  "v2/ops/overlay.mjs": "7e6e2c2ffd25006d52597ab8babc5f8f503d388a3fdf2fbc0eaea02799a020c9",
  "v2/ops/resize.mjs": "814e78ebce8eaf8f1f918688db7b52a141405e06a36ed4b25d04413d69e7d17b",
  "v2/ops/rotate.mjs": "a1b65616717bd2eed8db406affea3263b4674dada46b56441ef38167a187455d",
  "v2/util/mem.mjs": "4968d400dae069b4bf0ef4767c1802fd2cc7d15d90eda4cfadf5b4cd19b96c6d",
  "utils/wasm/svg.wasm": "85b663e8c33ead57f5d1c0c3a9d4cf2d87f0e53e62012af5ac9a5a25ef42037d",
  "utils/wasm/gif.wasm": "533dd675f21eaad1bed72c03359a0775c9966e89a51c6e9c86bc4d439a6413b0",
  "utils/wasm/png.wasm": "3687bebda95af7572626ab02c09c60a79f160385abad979dbb494f6b17cda2cf",
  "utils/wasm/font.wasm": "c244cd87aa57bd3ea39b55fc5d6c891fa2040dae6c5c41c49d9084b8e43919e8",
  "utils/wasm/jpeg.wasm": "019bcef4d864045e9b2df7e39ef6e7f3227d80b08a33742e1438441f2ddc2368",
  "utils/wasm/tiff.wasm": "410db4831b9ddd82f65df299f2fc1d4a2118756a1c649929403fee2716c14f8c",
  "utils/wasm/zlib.wasm": "a9d289c84dad1cbbbc15f3bad6d83b64ea3056598227cca1241e2debc13613c0",
  "LICENSE": null,
  "LICENSE.MIT": null,
};

export const WASM = ["svg", "gif", "png", "font", "jpeg", "tiff", "zlib"];

/** Formatos que nenhuma função usa: o .wasm fica FORA do pacote (svg 1,4 MB e tiff 254 KB em base64
 * empurravam o estudio-arte acima dos 5 MB de deploy do Supabase). Usar um deles dá erro claro. */
export const FORA_DO_PACOTE = ["svg", "tiff"];

const BLOCO_DO_FETCH =
  "{\n  const path = new URL(import.meta.url.replace('.js', '.wasm'));\n" +
  "  wasm_mod = new WebAssembly.Module(await ('file:' === path.protocol ? Deno.readFile(path) : fetch(path).then(r => r.arrayBuffer())));\n}\n";
const INSTANCIA = "new WebAssembly.Instance(wasm_mod";

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** O carregador trocado: sem fetch; o módulo compila na primeira instância. */
export function carregadorSemFetch(nome, original) {
  const txt = original.replace(/\r\n/g, "\n");
  if (txt.split(BLOCO_DO_FETCH).length !== 2) throw new Error(`${nome}.js: bloco do fetch não encontrado`);
  if (txt.split(INSTANCIA).length !== 2) throw new Error(`${nome}.js: instância do wasm não encontrada`);
  return (
    `// Cópia do imagescript@1.3.0 (MIT). Mudança local: o .wasm vem de ./${nome}.wasm.js\n` +
    `// e compila na primeira instância, sem fetch a deno.land (ver LEIA-ME.md).\n` +
    `import { bytesDoWasm } from './${nome}.wasm.js';\n` +
    txt.replace(BLOCO_DO_FETCH, "").replace(INSTANCIA, "new WebAssembly.Instance(wasm_mod ??= new WebAssembly.Module(bytesDoWasm())")
  );
}

/** Módulo com o .wasm em base64 (uma linha) e a leitura dos bytes. */
export function moduloDoWasm(nome, bytes) {
  if (FORA_DO_PACOTE.includes(nome)) {
    return (
      `// ${nome}.wasm do imagescript@1.3.0 fica fora desta cópia (nenhuma função usa; ver FORA_DO_PACOTE em
` +
      `// scripts/gerar-imagescript-vendor.mjs). SHA-256 do original: ${sha256(bytes)} (${bytes.length} bytes).
` +
      `export function bytesDoWasm() {
` +
      `  throw new Error("imagescript: o formato ${nome} não está incluído na cópia local (scripts/gerar-imagescript-vendor.mjs)");
` +
      `}
`
    );
  }
  return (
    `// ${nome}.wasm do imagescript@1.3.0 (MIT), em base64. Gerado por scripts/gerar-imagescript-vendor.mjs.\n` +
    `// SHA-256 do .wasm: ${sha256(bytes)} (${bytes.length} bytes).\n` +
    `import { bytesDoBase64 } from './base64.js';\n` +
    `const B64 = "${Buffer.from(bytes).toString("base64")}";\n` +
    `export function bytesDoWasm() { return bytesDoBase64(B64); }\n`
  );
}

async function ler(rel, de) {
  if (de) return readFileSync(join(de, rel));
  const r = await fetch(BASE + rel);
  if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function main() {
  const i = process.argv.indexOf("--de");
  const de = i > 0 ? process.argv[i + 1] : null;
  for (const [rel, esperado] of Object.entries(ORIGINAIS)) {
    const bytes = await ler(rel, de);
    if (esperado && sha256(bytes) !== esperado) throw new Error(`${rel}: SHA-256 não confere`);
    const nome = rel.match(/^utils\/wasm\/(\w+)\.(js|wasm)$/);
    let saida = bytes;
    let caminho = rel;
    if (nome && nome[2] === "js") saida = Buffer.from(carregadorSemFetch(nome[1], bytes.toString("utf8")));
    if (nome && nome[2] === "wasm") {
      saida = Buffer.from(moduloDoWasm(nome[1], bytes));
      caminho = `utils/wasm/${nome[1]}.wasm.js`;
    }
    mkdirSync(dirname(join(DESTINO, caminho)), { recursive: true });
    writeFileSync(join(DESTINO, caminho), saida);
  }
  writeFileSync(
    join(DESTINO, "utils", "wasm", "base64.js"),
    "// Parte local da cópia do imagescript: base64 -> bytes do .wasm (atob existe no Deno e no Edge Runtime).\n" +
      "export function bytesDoBase64(b64) {\n" +
      "  const bin = atob(b64);\n" +
      "  const out = new Uint8Array(bin.length);\n" +
      "  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);\n" +
      "  return out;\n" +
      "}\n",
  );
  console.log(`ok: ${DESTINO}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
