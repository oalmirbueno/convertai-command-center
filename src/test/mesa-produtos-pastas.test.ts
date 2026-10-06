import { describe, expect, it } from "vitest";
import { limparPastaDeProdutos } from "../../supabase/functions/mesa-foto/modulos/pastas-produtos";
import { kitParecido, mesclarKit, normalizarKit as kitDoServidor } from "../../supabase/functions/mesa-foto/calculos";
import { normalizarFoto, normalizarKit, corpoDoKit } from "@/components/mesa-foto/fotoApi";
import { organizarFotosPorProduto, type PessoaDaPasta } from "@/components/mesa-foto/pastasDosProdutos";
import { normalizarNo, corpoDoCanvas, canvasVazio } from "@/components/mesa-foto/canvasApi";

const CLIENTE = "c1";
const produto = (id = "p1", extra = {}) => normalizarKit({ id, client_id: CLIENTE, tipo: "produto", nome: "Óculos", status: "confirmado", atributos: { organizacao: { pasta: "Ótica / Solar" } }, refs: [], ...extra })!;
const foto = (id = "f1", extra = {}) => normalizarFoto({ id, client_id: CLIENTE, nome: id, storage_bucket: "mesa", storage_path: `${CLIENTE}/${id}.png`, ativa: true, tags: [], ...extra })!;
const pessoas: PessoaDaPasta[] = [{ id: "m1", client_id: CLIENTE, nome: "Lia", tipo: "modelo" }, { id: "r1", client_id: CLIENTE, nome: "Ana", tipo: "clone", identidade_real: [{ imagem_id: "retrato" }] }];

describe("organização por produto e pessoa", () => {
  it("mantém o clone escolhido ao salvar e reler a composição", () => {
    const cloneId = "01234567-1234-4234-8234-123456789012";
    const no = normalizarNo({ id: "pessoa", tipo: "modelo", dados: { imagem_id: "retrato", autorizada: true, clone_id: cloneId } })!;
    expect(corpoDoCanvas({ ...canvasVazio(CLIENTE), nos: [no] }).nos[0].dados.clone_id).toBe(cloneId);
    expect(normalizarNo({ ...no, dados: { ...no.dados, modelo_id: "sintetica" } })?.dados.clone_id).toBeUndefined();
  });
  it("um clone explícito não é confundido com outro cadastro que usa o mesmo retrato", () => {
    const org = organizarFotosPorProduto(CLIENTE, [foto("a", { gerada: true, modo: "canvas", tags: ["clone:r1"] })], [], [...pessoas, { ...pessoas[1], id: "r2" }], [{ imagem_id: "a", referencias: [{ papel: "pessoa", imagem_id: "retrato", origem: { tipo: "acervo", id: "retrato" } }] }]);
    expect(org[0].pessoas.map((p) => p.id)).toEqual(["r1"]);
  });
  it("salva e relê pasta no contrato existente do produto", () => {
    const salvo = kitDoServidor(corpoDoKit(produto()));
    expect(salvo.atributos.organizacao?.pasta).toBe("Ótica / Solar");
    expect(normalizarKit(salvo)?.atributos.organizacao).toEqual({ pasta: "Ótica / Solar" });
  });
  it("produtos sem marca com a mesma categoria não são unidos por nome", () => {
    const antigo = { id: "p1", nome: "Óculos", variante: null, status: "rascunho", refs: [{ imagem_id: "a", papel: "identidade" }] };
    expect(kitParecido([antigo], { nome: "Óculos", variante: null, refs: [{ imagem_id: "b", papel: "identidade" }] }, false)).toBeNull();
    expect(kitParecido([antigo], { nome: "Óculos", variante: null, refs: [{ imagem_id: "a", papel: "identidade" }] }, false)?.id).toBe("p1");
  });
  it("normaliza pastas sem usar caminhos físicos", () => {
    expect(limparPastaDeProdutos(" ../ Óculos \\ Sol / .. / Azul* ")).toBe("Óculos / Sol / Azul");
    expect(limparPastaDeProdutos(null)).toBe("");
  });
  it("mantém a pasta ao complementar a identificação do produto", () => {
    const antigo = { ...kitDoServidor(corpoDoKit(produto())), refs: [] };
    const novo = { ...antigo, atributos: { observado: ["caixa"], informado: [], inferido: [] } };
    expect(mesclarKit(antigo, novo).atributos.organizacao).toEqual({ pasta: "Ótica / Solar" });
  });
  it("separa dois produtos homônimos e duas pessoas homônimas pelos IDs", () => {
    const fotos = [foto("a", { gerada: true, modo: "canvas", kit_id: "p1", tags: ["persona:m1"] }), foto("b", { gerada: true, modo: "canvas", kit_id: "p2", tags: ["persona:m2"] })];
    const org = organizarFotosPorProduto(CLIENTE, fotos, [produto(), produto("p2")], [...pessoas, { ...pessoas[0], id: "m2" }], []);
    expect(org[0].chave).not.toBe(org[1].chave);
    expect(org[0].pasta).toContain("Modelo · Lia");
    expect(org[1].produtoIds).toEqual(["p2"]);
  });
  it("recupera clone do snapshot da geração, sem olhar um Canvas editado", () => {
    const org = organizarFotosPorProduto(CLIENTE, [foto("a", { gerada: true, modo: "canvas", kit_id: "p1" })], [produto()], pessoas, [{ imagem_id: "a", referencias: [{ papel: "pessoa", imagem_id: "retrato", origem: { tipo: "acervo", id: "retrato" } }] }]);
    expect(org[0].pasta).toBe("Gerações / Óculos / Clone · Ana");
  });
  it("tratamento herda a pasta da geração mantendo suas versões", () => {
    const org = organizarFotosPorProduto(CLIENTE, [foto("a", { gerada: true, modo: "canvas", kit_id: "p1", tags: ["persona:m1"] }), foto("b", { derivada_de: "a", modo: "luz_cor", aprovada: true })], [produto()], pessoas, []);
    expect(org).toHaveLength(2);
    expect(org[0].chave).toBe(org[1].chave);
  });
  it("uma nova composição não herda a pessoa da foto principal do produto", () => {
    const org = organizarFotosPorProduto(CLIENTE, [foto("a", { gerada: true, modo: "canvas", kit_id: "p1", tags: ["persona:m1"] }), foto("b", { gerada: true, modo: "canvas", derivada_de: "a", kit_id: "p1" })], [produto()], pessoas, []);
    expect(org[1].pessoas).toEqual([]);
    expect(org[1].pasta).toContain("Produto e cenário");
  });
  it("a caixa manualmente vinculada pertence à pasta das fotos do produto", () => {
    const org = organizarFotosPorProduto(CLIENTE, [foto("caixa")], [produto("p1", { refs: [{ imagem_id: "caixa", papel: "embalagem" }] })], [], []);
    expect(org[0].pasta).toBe("Produtos / Ótica / Solar / Óculos / Fotos do produto");
    expect(org[0].geracao).toBe(false);
  });
  it("não mistura clientes, clone compartilhado indevidamente nem produtos arquivados", () => {
    const org = organizarFotosPorProduto(CLIENTE, [foto(), foto("outro", { client_id: "c2" })], [produto("p1", { client_id: "c2" }), produto("p2", { status: "arquivado" })], [{ ...pessoas[1], client_id: null }], []);
    expect(org).toHaveLength(1);
    expect(org[0].produtoIds).toEqual([]);
    expect(org[0].pessoas).toEqual([]);
  });
  it("mantém explícita a falta de vínculo de uma pessoa gerada", () => {
    expect(organizarFotosPorProduto(CLIENTE, [foto("a", { gerada: true, tags: ["pessoa_sintetica"] })], [], [], [])[0].pasta).toContain("Pessoa sem vínculo");
  });
  it("a origem do Workspace e os arquivos são preservados", () => {
    const f = foto("a", { pasta: "Workspace / Originais", workspace_node_id: "w1", kit_id: "p1" });
    const org = organizarFotosPorProduto(CLIENTE, [f], [produto()], [], []);
    expect(org[0].foto).toBe(f);
    expect(f.pasta).toBe("Workspace / Originais");
    expect(f.workspace_node_id).toBe("w1");
  });
});
