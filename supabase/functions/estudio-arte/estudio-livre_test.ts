/**
 * 19/10/2026: Estúdio livre do Laboratório. A arte de origem 'laboratorio' vai para o Workspace global
 * (Laboratório / Livres ou o cliente / Estúdio livre / dia), sem cliente no nó, idempotente por lâmina e versão.
 *
 *   npx --yes deno test --allow-env --allow-read supabase/functions/estudio-arte/estudio-livre_test.ts
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ACOES_SO_DA_MESA,
  ehDoLaboratorio,
  guardarNoLaboratorio,
  type NoDaPasta,
  type NoNovoDoLaboratorio,
  origemDoPedido,
  pastaDoCliente,
  type PortaDoLaboratorio,
} from "./modulos/estudio-livre.ts";

type No = NoDaPasta & { scope: string; client_id: string | null; storage_path?: string };

function portaFalsa() {
  const nos: No[] = [];
  const subidos: string[] = [];
  let n = 0;
  const porta: PortaDoLaboratorio = {
    pastasFilhas: (parentId) => Promise.resolve(nos.filter((x) => x.kind === "folder" && x.parent_id === parentId)),
    criarPasta: (parentId, nome) => {
      const id = `p${++n}`;
      nos.push({ id, parent_id: parentId, name: nome, kind: "folder", scope: "global", client_id: null });
      return Promise.resolve(id);
    },
    noComPrefixo: (prefixo) => Promise.resolve(nos.filter((x) => x.kind === "file" && (x.storage_path || "").indexOf(`${prefixo}.`) === 0)[0] || null),
    subir: (caminho) => {
      subidos.push(caminho);
      return Promise.resolve();
    },
    criarNo: (linha: NoNovoDoLaboratorio) => {
      const id = `f${++n}`;
      nos.push({ id, parent_id: linha.parent_id, name: linha.name, kind: "file", scope: linha.scope, client_id: linha.client_id, storage_path: linha.storage_path });
      return Promise.resolve(id);
    },
  };
  return { porta, nos, subidos };
}

const lamina = (ordem: number, versao = 1) => ({
  ordem,
  versao,
  carregar: () => Promise.resolve({ bytes: new Uint8Array([1, 2, 3]), mime: "image/png", extensao: "png" }),
});

Deno.test("origem: só 'laboratorio' sai da Mesa", () => {
  assertEquals(origemDoPedido("laboratorio"), "laboratorio");
  assertEquals(origemDoPedido("mesa"), "mesa");
  assertEquals(origemDoPedido(null), "mesa");
  assert(ehDoLaboratorio({ origem: "laboratorio" }));
  assert(!ehDoLaboratorio({ origem: "mesa" }));
  assert(!ehDoLaboratorio(null));
  assert(ACOES_SO_DA_MESA.indexOf("rapida_para_agenda") >= 0 && ACOES_SO_DA_MESA.indexOf("entregar") < 0);
});

Deno.test("guardar: cliente de verdade vai para a pasta dele, no escopo global, uma vez por versão", async () => {
  const f = portaFalsa();
  const entrada = { trabalhoId: "t-9", titulo: "Promo do pão", nomeDoCliente: pastaDoCliente({ company_name: "Padaria Sol", services_config: {} }), dia: "2026-10-19", criadoPor: "u-1", laminas: [lamina(1)] };
  const r = await guardarNoLaboratorio(f.porta, entrada);
  assertEquals(r.caminho, ["Laboratório", "Padaria Sol", "Estúdio livre", "2026-10-19"]);
  assertEquals(f.nos.filter((x) => x.kind === "folder").map((x) => x.name), ["Laboratório", "Padaria Sol", "Estúdio livre", "2026-10-19"]);
  const arquivo = f.nos.filter((x) => x.kind === "file")[0];
  assertEquals(arquivo.scope, "global");
  assertEquals(arquivo.client_id, null);
  assertEquals(arquivo.name, "Promo do pão.png");
  assertEquals(f.subidos, ["global/laboratorio/estudio-livre/t-9/1-v1.png"]);
  const de_novo = await guardarNoLaboratorio(f.porta, entrada);
  assertEquals(de_novo.novos, 0);
  assertEquals(f.subidos.length, 1);
  assertEquals(f.nos.filter((x) => x.kind === "folder").length, 4);
});

Deno.test("guardar: cliente interno vai para Livres", () => {
  assertEquals(pastaDoCliente({ company_name: "Aceleriq", services_config: { internal_company: true } }), null);
});
