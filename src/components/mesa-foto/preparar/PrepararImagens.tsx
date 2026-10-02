import { useMemo, useState } from "react";
import { Check, ImagePlus, Package, Search, Shapes, SlidersHorizontal } from "lucide-react";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { useMesa } from "@/components/mesa/MesaContexto";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { botao, foco, juntar, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { useMesaFoto } from "../Comuns";
import { useFotos, useKits } from "../fotoApi";
import SeletorDeImagens from "../seletores/SeletorDeImagens";
import SeletorDeModelo from "../seletores/SeletorDeModelo";
import { capaDoProduto, dadosDaPessoa, produtosPorDepartamento, type OpcaoDeModelo } from "../seletores/seletores";
import EdicaoDeImagens from "./EdicaoDeImagens";
import { imagensParaEditar, levarSelecaoAoCanvas } from "./preparo";

/**
 * Preparar imagens (02/10/2026; dono: "uma área para preparar imagens: de um
 * lado todos os produtos, como uma linha de catálogo organizada por
 * departamento; do outro os clones e modelos já prontos para escolher").
 *
 * Janela central larga, em duas colunas: à esquerda o catálogo (Produtos por
 * departamento, Artes e Fotos do acervo, com o filtro Editadas); à direita o
 * seletor de modelo (modelos da IA e clones autorizados). Embaixo, dois
 * caminhos: Editar imagens (as marcadas e a capa dos produtos marcados, com
 * antes e depois) e Montar no Canvas (uma caixa nova com os produtos, a
 * pessoa e as imagens como estilo, já ligados). A escolha fica guardada por
 * cliente.
 */

type Aba = "produtos" | "artes" | "fotos";
const ABAS: { valor: Aba; rotulo: string }[] = [
  { valor: "produtos", rotulo: "Produtos" },
  { valor: "artes", rotulo: "Artes" },
  { valor: "fotos", rotulo: "Fotos" },
];

interface ModeloGuardado {
  chave: string;
  nome: string;
  pessoa: ReturnType<typeof dadosDaPessoa>;
}

const lerIds = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string");

function Catalogo({ kitIds, onKits }: { kitIds: string[]; onKits: (ids: string[]) => void }) {
  const { clientId } = useMesa();
  const { irPara } = useMesaFoto();
  const kitsQ = useKits(clientId);
  const fotos = useFotos(clientId).data || [];
  const [busca, setBusca] = useState("");
  const departamentos = useMemo(() => produtosPorDepartamento(kitsQ.data || [], busca), [kitsQ.data, busca]);
  const alternar = (id: string) => onKits(kitIds.indexOf(id) >= 0 ? kitIds.filter((x) => x !== id) : kitIds.concat([id]));
  if (kitsQ.isLoading) return <div className="h-40 animate-pulse rounded-md bg-muted" aria-busy="true" />;
  const total = (kitsQ.data || []).filter((k) => k.tipo !== "pessoa" && k.status !== "arquivado").length;
  if (!total)
    return (
      <div className="min-w-0 py-6 text-center">
        <p className={texto.corpo}>Nenhum produto cadastrado ainda.</p>
        <button type="button" className={juntar(botao.secundario, "mt-2")} onClick={() => irPara("acervo")}>
          <ImagePlus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Identificar um produto nas fotos
        </button>
      </div>
    );
  return (
    <div className="min-w-0" data-catalogo-de-produtos="">
      <label className="mb-3 flex h-8 min-w-0 items-center rounded-md border border-border px-2 sm:max-w-[280px]">
        <Search className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto" aria-label="Buscar produto" className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
      </label>
      {departamentos.length === 0 && <p className={texto.auxiliar}>Nenhum produto com esse nome.</p>}
      {departamentos.map((d) => (
        <section key={d.tipo} className="mb-4 min-w-0" aria-label={d.rotulo} data-departamento={d.tipo}>
          <h4 className={juntar(texto.rotulo, "mb-2")}>
            {d.rotulo} <span className="tabular-nums">({d.kits.length})</span>
          </h4>
          <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {d.kits.map((k) => {
              const id = String(k.id);
              const capaId = capaDoProduto(k);
              const capa = capaId ? fotos.find((f) => f.id === capaId) || null : null;
              const marcado = kitIds.indexOf(id) >= 0;
              return (
                <li key={id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => alternar(id)}
                    aria-pressed={marcado}
                    className={juntar("relative block w-full overflow-hidden rounded-md border-2 text-left transition-colors", marcado ? "border-primary" : "border-border hover:border-primary/50", foco)}
                    data-produto-do-catalogo={id}
                  >
                    <span className="block aspect-square w-full bg-muted">
                      {capa ? (
                        <MiniaturaDoStorage bucket={capa.storage_bucket} caminho={capa.storage_path} alt={k.nome} largura={240} className="h-full w-full" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <Package className="h-6 w-6" aria-hidden="true" />
                        </span>
                      )}
                    </span>
                    {marcado && (
                      <span className="pointer-events-none absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" aria-hidden="true" />
                      </span>
                    )}
                    <span className="block truncate px-1.5 pt-1 text-[12px] font-medium">{k.nome}</span>
                    <span className="block truncate px-1.5 pb-1 text-[11px] text-muted-foreground">{k.variante || (k.status === "confirmado" ? "Confirmado" : "Rascunho")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function PrepararImagens({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  const { clientId } = useMesa();
  const { irPara, etapa } = useMesaFoto();
  const kits = useKits(clientId).data || [];
  const [aba, setAba] = useEstadoDaTela<Aba>(`mesa-foto:preparar-imagens:aba:${clientId}`, "produtos", { validar: (v) => v === "produtos" || v === "artes" || v === "fotos" });
  const [kitIds, setKitIds] = useEstadoDaTela<string[]>(`mesa-foto:preparar-imagens:produtos:${clientId}`, [], { validar: lerIds });
  const [imagemIds, setImagemIds] = useEstadoDaTela<string[]>(`mesa-foto:preparar-imagens:imagens:${clientId}`, [], { validar: lerIds });
  const [modelo, setModelo] = useEstadoDaTela<ModeloGuardado | null>(`mesa-foto:preparar-imagens:modelo:${clientId}`, null, {
    validar: (v) => v === null || (!!v && typeof v === "object" && typeof (v as ModeloGuardado).chave === "string"),
  });
  const [editando, setEditando] = useState<string[] | null>(null);

  const paraEditar = imagensParaEditar(imagemIds, kitIds, kits);
  const resumo = [
    kitIds.length ? `${kitIds.length} ${kitIds.length === 1 ? "produto" : "produtos"}` : "",
    imagemIds.length ? `${imagemIds.length} ${imagemIds.length === 1 ? "imagem" : "imagens"}` : "",
    modelo ? modelo.nome : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const escolherModelo = (o: OpcaoDeModelo | null) => setModelo(o ? { chave: o.chave, nome: o.nome, pessoa: dadosDaPessoa(o) } : null);

  const montarNoCanvas = () => {
    levarSelecaoAoCanvas(clientId, { kit_ids: kitIds, imagem_ids: imagemIds, pessoa: modelo ? modelo.pessoa : null });
    onFechar();
    if (etapa === "canvas") {
      try {
        window.dispatchEvent(new Event("mesa-foto:peca-levada"));
      } catch {
        /* sem evento: entra ao reabrir o Canvas */
      }
    } else irPara("canvas");
  };

  const limpar = () => {
    setKitIds([]);
    setImagemIds([]);
    setModelo(null);
  };

  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={() => {
        setEditando(null);
        onFechar();
      }}
      titulo={editando ? "Editar imagens" : "Preparar imagens"}
      icone={editando ? <SlidersHorizontal className="h-4 w-4 text-primary" /> : <ImagePlus className="h-4 w-4 text-primary" />}
      descricao={editando ? `${editando.length} ${editando.length === 1 ? "imagem" : "imagens"} na fila` : resumo || "Escolha produtos, imagens e a pessoa"}
      ajuda="À esquerda, os produtos por departamento, as artes e as fotos do acervo (o filtro Editadas mostra as versões novas). À direita, as modelos da IA e os clones autorizados. Editar imagens grava versões novas no acervo, com antes e depois. Montar no Canvas abre uma caixa nova já ligada. Tudo fica no acervo do cliente, que a Mesa Vídeos, a Motion e o Estúdio também usam."
      largura="tela"
      corpo="fixo"
      data-preparar-imagens=""
      rodape={
        editando ? null : (
          <div className="flex min-w-0 flex-wrap items-center justify-end">
            <button type="button" className={juntar(botao.discreto, "mb-1 mr-auto")} onClick={limpar} disabled={!resumo}>
              Limpar a escolha
            </button>
            <button type="button" className={juntar(botao.secundario, "mb-1 ml-2")} onClick={() => setEditando(paraEditar)} disabled={!paraEditar.length} data-editar-imagens="">
              <SlidersHorizontal className="mr-1.5 h-4 w-4" aria-hidden="true" /> Editar imagens{paraEditar.length ? ` (${paraEditar.length})` : ""}
            </button>
            <button type="button" className={juntar(botao.primario, "mb-1 ml-2")} onClick={montarNoCanvas} disabled={!kitIds.length && !modelo} data-montar-no-canvas="">
              <Shapes className="mr-1.5 h-4 w-4" aria-hidden="true" /> Montar no Canvas
            </button>
          </div>
        )
      }
    >
      {editando ? (
        <EdicaoDeImagens ids={editando} onIds={setEditando} onVoltar={() => setEditando(null)} />
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:flex-row">
          <section className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-2 scrollbar-hidden lg:pr-5" aria-label="Catálogo" data-coluna-catalogo="">
            <div role="tablist" aria-label="O que escolher" className="mb-3 inline-flex rounded-lg bg-muted p-0.5">
              {ABAS.map((a) => (
                <button
                  key={a.valor}
                  type="button"
                  role="tab"
                  aria-selected={aba === a.valor}
                  onClick={() => setAba(a.valor)}
                  className={juntar("h-8 rounded-md px-3 text-[13px] font-medium transition-colors", aba === a.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground", foco)}
                  data-aba-do-catalogo={a.valor}
                >
                  {a.rotulo}
                  {a.valor === "produtos" && kitIds.length ? ` (${kitIds.length})` : ""}
                </button>
              ))}
            </div>
            {aba === "produtos" && <Catalogo kitIds={kitIds} onKits={setKitIds} />}
            {aba === "artes" && <SeletorDeImagens clientId={clientId} escolhidas={imagemIds} onMudar={setImagemIds} filtroInicial="artes" filtros={["artes"]} rotulo="Artes" />}
            {aba === "fotos" && <SeletorDeImagens clientId={clientId} escolhidas={imagemIds} onMudar={setImagemIds} filtros={["todas", "produtos", "editadas", "originais", "geradas"]} rotulo="Fotos do acervo" />}
          </section>
          <section className="mt-4 max-h-[45%] min-h-0 min-w-0 shrink-0 overflow-y-auto border-t border-border pt-4 scrollbar-hidden lg:mt-0 lg:max-h-none lg:w-[340px] lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0" aria-label="Modelos e clones" data-coluna-modelos="">
            <h4 className={juntar(texto.rotulo, "mb-2")}>Modelos e clones</h4>
            <SeletorDeModelo
              clientId={clientId}
              valor={modelo ? modelo.chave : null}
              onEscolher={escolherModelo}
              onCriar={() => {
                onFechar();
                irPara("modelos");
              }}
            />
          </section>
        </div>
      )}
    </JanelaCentral>
  );
}
