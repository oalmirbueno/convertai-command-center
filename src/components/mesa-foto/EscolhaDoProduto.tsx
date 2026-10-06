import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, PackagePlus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { campo, foco, juntar } from "@/components/sistema/estilos";
import { MiniaturaDaFoto, useMesaFoto } from "./Comuns";
import { chaveDosKits, rotuloDoTipo, salvarKit, useFotos, useKits, type FotoDoAcervo, type KitDeFoto } from "./fotoApi";

/**
 * O produto da geração (02/10, dono: "aparece uma moldura de tartaruga como
 * Seu produto, sem nome, e não dá para trocar"): o produto escolhido com a
 * capa, o NOME e o tipo; "Trocar" abre a lista de todos os produtos (capa e
 * nome) com rolagem própria. Produto sem nome ganha nome aqui mesmo.
 */

/** O nome do produto; sem nome (ou com o nome padrão do kit), "Produto sem nome". */
export const nomeDoKit = (k: Pick<KitDeFoto, "nome"> | null | undefined) => (k && k.nome && k.nome.trim() && k.nome.trim() !== "Kit sem nome" ? k.nome.trim() : "Produto sem nome");

export function capaDoKit(k: KitDeFoto, fotos: FotoDoAcervo[]): FotoDoAcervo | null {
  const id = k.frente_imagem_id || (k.refs.find((r) => r.papel === "identidade") || k.refs[0] || { imagem_id: "" }).imagem_id;
  return fotos.find((f) => f.id === id) || null;
}

export default function EscolhaDoProduto({ rotulo = "Produto", className = "" }: { rotulo?: string; className?: string }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const { kitId, escolherKit, irPara } = useMesaFoto();
  const kitsQ = useKits(clientId);
  const fotosQ = useFotos(clientId);
  const kits = useMemo(() => (kitsQ.data || []).filter((k) => k.status !== "arquivado" && !!k.id), [kitsQ.data]);
  const fotos = fotosQ.data || [];
  const kit = kitId ? kits.find((k) => k.id === kitId) || null : null;
  const buscaRef = useRef<HTMLInputElement>(null);
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState(false);
  const [nome, setNome] = useState<string | null>(null);
  const listaAberta = aberta || kits.length > 0;
  const visiveis = kits.filter((k) => `${nomeDoKit(k)} ${k.variante || ""}`.toLocaleLowerCase("pt-BR").includes(busca.toLocaleLowerCase("pt-BR")));

  const darNome = async () => {
    if (!kit || nome === null || !nome.trim()) return;
    try {
      await salvarKit(clientId, { ...kit, nome: nome.trim().slice(0, 120) });
      void queryClient.invalidateQueries({ queryKey: chaveDosKits(clientId) });
      setNome(null);
    } catch (e) {
      avisarErro(e, "Nome não gravado");
    }
  };

  return (
    <div className={juntar("min-w-0", className)} data-escolha-do-produto="" data-produto-escolhido={kit ? String(kit.id) : ""}>
      <div className="flex min-w-0 items-center">
        <span className="mr-2 text-[12px] font-medium text-muted-foreground">{rotulo}</span>
        <AjudaRecolhida rotulo="Sobre o produto">O produto nunca muda na foto: forma, cor, rótulo e proporção saem das fotos dele. Troque aqui quando quiser outro.</AjudaRecolhida>
      </div>
      {kit ? (
        <div className="mt-1.5 flex min-w-0 items-center" data-produto-atual="">
          <span className="mr-2.5 w-14 shrink-0">{capaDoKit(kit, fotos) ? <MiniaturaDaFoto foto={capaDoKit(kit, fotos)!} selo={false} /> : <span className="block h-14 w-14 rounded-lg bg-muted" />}</span>
          <div className="min-w-0 flex-1">
            {nome !== null ? (
              <form
                className="flex min-w-0 items-center"
                onSubmit={(e) => {
                  e.preventDefault();
                  void darNome();
                }}
              >
                <input value={nome} onChange={(e) => setNome(e.target.value)} className={juntar(campo, "h-8 text-[12.5px]")} aria-label="Nome do produto" placeholder="Nome do produto" autoFocus />
                <Button type="submit" size="sm" className="ml-1.5 h-8 shrink-0 text-[12px]" disabled={!nome.trim()}>
                  Salvar
                </Button>
              </form>
            ) : (
              <p className="flex min-w-0 items-center text-[13.5px] font-semibold" data-nome-do-produto="">
                <span className="min-w-0 truncate">{nomeDoKit(kit)}</span>
                <button type="button" className={juntar("ml-1.5 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground", foco)} onClick={() => setNome(kit.nome || "")} aria-label="Mudar o nome do produto">
                  <Pencil className="h-3 w-3" />
                </button>
              </p>
            )}
            <p className="truncate text-[12px] text-muted-foreground">
              {rotuloDoTipo(kit.tipo)}
              {kit.variante ? ` · ${kit.variante}` : ""} · {kit.refs.length} {kit.refs.length === 1 ? "foto" : "fotos"}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" className="ml-2 h-8 shrink-0 text-[12px]" onClick={() => { setAberta(true); buscaRef.current?.focus(); }} aria-expanded={listaAberta} data-trocar-produto="">
            Trocar <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      ) : kits.length === 0 && kitsQ.isSuccess ? (
        <Button type="button" size="sm" className="mt-1.5 h-8 text-[12px]" onClick={() => irPara("acervo")}>
          <PackagePlus className="mr-1.5 h-3.5 w-3.5" /> Identificar o produto nas fotos
        </Button>
      ) : null}
      {listaAberta && <label className="mt-3 block text-[12px]">Produtos do cliente · {kits.length}<input className={juntar(campo, "mt-1")} ref={buscaRef} aria-label="Buscar produto do cliente" placeholder="Buscar pelo nome ou variante" value={busca} onChange={(e) => setBusca(e.target.value)} /></label>}
      {listaAberta && (
        <ul className="mt-2 min-w-0 rounded-lg scrollbar-hidden lg:max-h-64 lg:overflow-y-auto lg:overscroll-contain border border-border p-1" role="listbox" aria-label="Escolher o produto" data-lista-de-produtos="">
          {visiveis.map((k) => {
            const capa = capaDoKit(k, fotos);
            const ativo = k.id === kitId;
            return (
              <li key={String(k.id)} className="min-w-0">
                <button
                  type="button"
                  role="option"
                  aria-selected={ativo}
                  onClick={() => {
                    escolherKit(String(k.id));
                    setAberta(false);
                  }}
                  className={juntar("flex w-full min-w-0 items-center rounded-md p-1.5 text-left hover:bg-muted", ativo && "bg-primary/[0.06]", foco)}
                  data-produto-opcao={String(k.id)}
                >
                  <span className="mr-2 w-10 shrink-0">{capa ? <MiniaturaDaFoto foto={capa} selo={false} /> : <span className="block h-10 w-10 rounded-md bg-muted" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium">{nomeDoKit(k)}</span>
                    <span className="block truncate text-[11.5px] text-muted-foreground">
                      {rotuloDoTipo(k.tipo)}
                      {k.status === "rascunho" ? " · rascunho" : ""}
                    </span>
                  </span>
                  {ativo && <Check className="ml-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
          <li className="min-w-0 border-t border-border pt-1">
            <button type="button" onClick={() => irPara("acervo")} className={juntar("flex w-full items-center rounded-md p-1.5 text-left text-[12px] text-primary hover:bg-muted", foco)}>
              <PackagePlus className="mr-2 h-4 w-4" /> Identificar outro produto
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
