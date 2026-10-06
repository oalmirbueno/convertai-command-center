import { limparPastaDeProdutos } from "../../../supabase/functions/mesa-foto/modulos/pastas-produtos";
import type { FotoDoAcervo, KitDeFoto } from "./fotoApi";

export const pastaDoProduto = (k: KitDeFoto) => limparPastaDeProdutos(k.atributos.organizacao?.pasta);
export type PessoaDaPasta = { id: string; client_id: string | null; nome: string; tipo: "modelo" | "clone"; identidade_real?: { imagem_id: string }[] };
export type ReferenciaDaGeracao = { papel: string; imagem_id?: string; origem?: { tipo: string; id: string } };
export type VinculoDaGeracao = { imagem_id: string; referencias: ReferenciaDaGeracao[] };
export type FotoOrganizada = { foto: FotoDoAcervo; produtoIds: string[]; pessoas: PessoaDaPasta[]; pasta: string; chave: string; geracao: boolean };

/** IDs e a fotografia das referências da geração são a fonte; o Canvas atual pode ter sido editado. */
export function organizarFotosPorProduto(clientId: string, fotos: FotoDoAcervo[], kits: KitDeFoto[], pessoas: PessoaDaPasta[], vinculos: VinculoDaGeracao[]): FotoOrganizada[] {
  const produtos = kits.filter((k) => k.client_id === clientId && k.tipo !== "pessoa" && k.status !== "arquivado" && k.id);
  const permitidas = pessoas.filter((p) => p.client_id === clientId || (p.tipo === "modelo" && p.client_id === null));
  const doCliente = fotos.filter((f) => f.client_id === clientId && f.ativa);
  const porId = new Map(doCliente.map((f) => [f.id, f]));
  const historico = new Map(vinculos.map((v) => [v.imagem_id, v.referencias]));
  return doCliente.map((foto) => {
    // Tratamentos herdam o vínculo, mas uma composição nova não herda a pessoa da foto do produto.
    let origem = foto;
    const vistos = new Set<string>();
    while (origem.derivada_de && !["canvas", "ensaio", "clone"].includes(origem.modo || "") && !historico.has(origem.id) && !vistos.has(origem.id)) {
      vistos.add(origem.id);
      const anterior = porId.get(origem.derivada_de);
      if (!anterior) break;
      origem = anterior;
    }
    const tags = [...foto.tags, ...origem.tags];
    const refs = historico.get(origem.id) || [];
    const escolhidos = produtos.filter((k) => foto.kit_id === k.id || origem.kit_id === k.id || tags.includes(`kit:${k.id}`) || k.refs.some((r) => r.imagem_id === foto.id || r.imagem_id === origem.id));
    const cloneExplicito = tags.some((t) => t.startsWith("clone:"));
    const comPessoas = permitidas.filter((p) => tags.includes(`persona:${p.id}`) || tags.includes(`clone:${p.id}`) || tags.includes(`personagem:${p.id}`) || refs.some((r) => r.papel === "pessoa" && (
      (r.origem?.tipo === "persona" && r.origem.id === p.id) || (!cloneExplicito && r.origem?.tipo === "acervo" && p.tipo === "clone" && p.identidade_real?.some((i) => i.imagem_id === r.imagem_id) && permitidas.filter((x) => x.tipo === "clone" && x.identidade_real?.some((i) => i.imagem_id === r.imagem_id)).length === 1)
    )));
    const geracao = foto.gerada || !!foto.derivada_de;
    const partePessoa = comPessoas.length ? comPessoas.map((p) => `${p.tipo === "clone" ? "Clone" : "Modelo"} · ${p.nome}`).sort().join(" + ")
      : tags.some((t) => t === "pessoa_sintetica" || t === "pessoa_real_autorizada") ? "Pessoa sem vínculo" : "Produto e cenário";
    const parteProduto = escolhidos.length ? escolhidos.map((k) => limparPastaDeProdutos(k.nome) || "Produto").sort().join(" + ") : "Sem produto";
    const pasta = geracao ? `Gerações / ${parteProduto} / ${partePessoa}` : escolhidos.length ? `Produtos / ${pastaDoProduto(escolhidos[0]) ? `${pastaDoProduto(escolhidos[0])} / ` : ""}${parteProduto} / Fotos do produto` : foto.pasta || "Sem pasta";
    return { foto, produtoIds: escolhidos.map((k) => k.id!), pessoas: comPessoas, geracao, pasta,
      chave: `${geracao ? "geracoes" : "fontes"}:${escolhidos.map((k) => k.id).sort().join(",")}:${comPessoas.map((p) => `${p.tipo}:${p.id}`).sort().join(",") || partePessoa}` };
  });
}
