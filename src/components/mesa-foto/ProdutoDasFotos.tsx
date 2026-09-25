import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2, PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { MiniaturaDaFoto, useMesaFoto } from "./Comuns";
import CartaoDaIdentificacao, { AcoesDaIdentificacao } from "./Identificacao";
import { gravarNaSessao, lerDaSessao } from "./sessao";
import {
  chaveDosKits,
  classeDaFoto,
  identificarProduto,
  invalidarFotos,
  MAX_FOTOS_NA_IDENTIFICACAO,
  normalizarIdentificacao,
  partesDaIdentificacao,
  rotuloDoTipo,
  salvarKit,
  useKits,
  type FotoDoAcervo,
  type IdentificacaoDoProduto,
  type KitDeFoto,
} from "./fotoApi";

/**
 * O produto dentro do passo 1 (pedido do dono, 25/09: "a gente gera foto,
 * depois vai pro produto, cola, monta os kits, é muito confuso"): a pessoa
 * sobe as fotos e toca em "Identificar o produto"; a identificação lê a
 * embalagem ou a foto, acha as fotos oficiais e já grava o produto (kit
 * rascunho) sozinha. Aqui só se escolhe e confirma o produto. O detalhe do
 * kit (papéis das fotos, lacunas) segue em Produto (?etapa=kits), para quem
 * quiser ajustar.
 */

/** As fotos que a identificação lê: as marcadas; sem marca, as originais mais recentes. */
export function fotosParaIdentificar(todas: FotoDoAcervo[], selecionadas: string[]): string[] {
  const marcadas = selecionadas.filter((id) => todas.some((f) => f.id === id && !f.referencia_web));
  if (marcadas.length) return marcadas.slice(0, MAX_FOTOS_NA_IDENTIFICACAO);
  return todas
    .filter((f) => classeDaFoto(f) === "original" && !f.referencia_web)
    .slice(0, MAX_FOTOS_NA_IDENTIFICACAO)
    .map((f) => f.id);
}

function ChipDoProduto({ kit, capa, ativo, onEscolher }: { kit: KitDeFoto; capa: FotoDoAcervo | null; ativo: boolean; onEscolher: () => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [confirmando, setConfirmando] = useState(false);
  const confirmar = async () => {
    setConfirmando(true);
    try {
      await salvarKit(clientId, { ...kit, status: "confirmado" });
      void queryClient.invalidateQueries({ queryKey: chaveDosKits(clientId) });
    } catch (e) {
      avisarErro(e, "Produto não confirmado");
    } finally {
      setConfirmando(false);
    }
  };
  return (
    <li className={`flex min-w-0 items-center rounded-xl border bg-card p-1.5 ${ativo ? "border-primary" : "border-border"}`} data-produto={kit.id}>
      <button type="button" onClick={onEscolher} className="flex min-w-0 flex-1 items-center text-left" aria-pressed={ativo} aria-label={`Escolher o produto ${kit.nome}`}>
        <span className="mr-2 w-10 shrink-0">{capa ? <MiniaturaDaFoto foto={capa} selo={false} /> : <span className="block h-10 w-10 rounded-lg bg-muted" />}</span>
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-semibold">{kit.nome || "Produto sem nome"}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {rotuloDoTipo(kit.tipo)}
            {kit.variante ? ` · ${kit.variante}` : ""} · {kit.refs.length} {kit.refs.length === 1 ? "foto" : "fotos"}
          </span>
        </span>
      </button>
      {kit.status === "rascunho" ? (
        <Button type="button" size="sm" variant={ativo ? "default" : "outline"} className="ml-1.5 h-7 shrink-0 px-2 text-[11.5px]" disabled={confirmando} onClick={() => void confirmar()}>
          {confirmando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
          Confirmar
        </Button>
      ) : (
        <span className="ml-1.5 inline-flex shrink-0 items-center text-[11px] text-success">
          <Check className="mr-0.5 h-3 w-3" /> confirmado
        </span>
      )}
    </li>
  );
}

export default function ProdutoDasFotos({ fotos }: { fotos: FotoDoAcervo[] }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const { kitId, escolherKit, irPara, selecionadas } = useMesaFoto();
  const [identificacao, setIdentificacaoNaTela] = useState<IdentificacaoDoProduto | null>(() => {
    const bruta = lerDaSessao<any>(clientId, "identificacao");
    return bruta ? normalizarIdentificacao(bruta) : null;
  });
  const setIdentificacao = (i: IdentificacaoDoProduto | null) => {
    setIdentificacaoNaTela(i);
    gravarNaSessao(clientId, "identificacao", i);
  };
  const kitsQ = useKits(clientId);
  const kits = (kitsQ.data || []).filter((k) => k.status !== "arquivado");
  const paraLer = fotosParaIdentificar(fotos, selecionadas);
  const kit = kitId ? kits.find((k) => k.id === kitId) || null : null;
  const capaDe = (k: KitDeFoto) => fotos.find((f) => f.id === (k.frente_imagem_id || (k.refs[0] && k.refs[0].imagem_id))) || null;

  const abrir = (ids: string[]) => {
    void queryClient.invalidateQueries({ queryKey: chaveDosKits(clientId) });
    if (ids[0]) escolherKit(ids[0]);
  };

  return (
    <section className={`min-w-0 rounded-xl border bg-card p-4 ${!kits.length ? "border-primary/50" : "border-border"}`} aria-label="O produto" data-produto-das-fotos="">
      <div className="mb-2 flex min-w-0 flex-wrap items-start">
        <div className="mr-2 min-w-0 flex-1">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">O produto</h3>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            {kits.length
              ? "Escolha o produto das fotos e confirme. A identificação já montou tudo: fotos, referências e o que não pode mudar."
              : "Toque em Identificar: a leitura acha marca, modelo e variante pela embalagem ou pela foto, busca as fotos oficiais e monta o produto sozinha."}
          </p>
        </div>
        <BotaoComCusto
          rotulo={
            <>
              <PackageSearch className="mr-1.5 h-3.5 w-3.5" /> Identificar o produto{paraLer.length ? ` (${paraLer.length} ${paraLer.length === 1 ? "foto" : "fotos"})` : ""}
            </>
          }
          titulo="Produto identificado"
          descricao="Lê a embalagem ou a foto, pesquisa o produto real e grava o produto como rascunho. As fotos da internet são só para fidelidade, não para publicar."
          variant={kits.length ? "outline" : "default"}
          className="h-8 text-[12px]"
          disabled={!paraLer.length}
          partes={() => partesDaIdentificacao(catalogo, paraLer.length)}
          executar={() => identificarProduto(clientId, paraLer)}
          aoConcluir={(data: IdentificacaoDoProduto) => {
            setIdentificacao(data);
            invalidarFotos(queryClient, clientId);
            if (data && data.kit && data.kit.id) abrir([data.kit.id]);
          }}
        />
      </div>
      {!selecionadas.length && paraLer.length > 0 && !kits.length && (
        <p className="mb-2 text-[11px] text-muted-foreground">Sem foto marcada, lê as {paraLer.length} originais mais recentes. Marque as da embalagem para escolher.</p>
      )}

      {kits.length > 0 && (
        <div className="max-h-56 min-w-0 overflow-y-auto" data-rolagem-propria="">
          <ul className="grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
            {kits.map((k) => (
              <ChipDoProduto key={String(k.id)} kit={k} capa={capaDe(k)} ativo={k.id === kitId} onEscolher={() => escolherKit(k.id)} />
            ))}
          </ul>
        </div>
      )}

      {identificacao && (
        <div className="mt-3">
          <CartaoDaIdentificacao
            identificacao={identificacao}
            compacto
            acoes={
              <>
                <AcoesDaIdentificacao
                  identificacao={identificacao}
                  onKits={(ids, avisar) => {
                    abrir(ids);
                    // "Ver detalhes" (avisar false): abre o produto em Produto, para ajustar.
                    if (avisar === false) irPara("kits", { kit: ids[0] || null });
                  }}
                />
                <button type="button" className="mb-1.5 h-8 px-1.5 text-[12px] text-muted-foreground hover:text-foreground" onClick={() => setIdentificacao(null)}>
                  Dispensar
                </button>
              </>
            }
          />
        </div>
      )}

      {kit && (
        <div className="mt-3 flex min-w-0 flex-wrap items-center">
          <Button type="button" size="sm" className="mb-1 mr-2 h-8 text-[12px]" onClick={() => irPara("criar")} data-criar-deste-produto="">
            Criar fotos de {kit.nome || "este produto"} <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
          <button type="button" className="mb-1 text-[12px] text-muted-foreground hover:text-foreground" onClick={() => irPara("kits", { kit: kit.id })}>
            Detalhes do produto
          </button>
        </div>
      )}
    </section>
  );
}
