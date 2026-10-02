import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Images, Loader2, Megaphone, PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { MiniaturaDaFoto, useMesaFoto } from "./Comuns";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import CartaoDaIdentificacao, { AcoesDaIdentificacao } from "./Identificacao";
import { useSeguirNaLinha } from "./GuiaDaLinha";
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

function ChipDoProduto({ kit, capa, ativo, onEscolher, grande = false }: { kit: KitDeFoto; capa: FotoDoAcervo | null; ativo: boolean; onEscolher: () => void; grande?: boolean }) {
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
    <li className={`flex min-w-0 items-center rounded-lg border p-1.5 ${ativo ? "border-primary" : "border-border"}`} data-produto={kit.id}>
      <button type="button" onClick={onEscolher} className="flex min-w-0 flex-1 items-center text-left" aria-pressed={ativo} aria-label={`Escolher o produto ${kit.nome}`}>
        <span className={`mr-2 shrink-0 ${grande ? "w-14" : "w-10"}`}>{capa ? <MiniaturaDaFoto foto={capa} selo={false} /> : <span className={`block rounded-lg bg-muted ${grande ? "h-14 w-14" : "h-10 w-10"}`} />}</span>
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

export default function ProdutoDasFotos({ fotos, recolhidoDeInicio = false, coluna = false }: { fotos: FotoDoAcervo[]; recolhidoDeInicio?: boolean; /** Coluna própria ao lado da grade (02/10): sem linha em cima, lista em uma coluna e capa grande. */ coluna?: boolean }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const { kitId, escolherKit, irPara, selecionadas, escolherObjetivo } = useMesaFoto();
  // Frente FTL (30/09): com o objetivo que pede o produto, o botão segue para gerar.
  const { objetivo } = useSeguirNaLinha();
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
  // 28/09 (dono: "recolher ali no Produto"): o bloco recolhe e mostra só o produto escolhido.
  // 30/09: quem vai melhorar uma foto, tirar fundo ou montar post não precisa do produto: começa recolhido.
  const [recolhido, setRecolhido] = useRecolhido(`mesa-foto:acervo:produto-recolhido:${clientId}`, recolhidoDeInicio);
  const resumo = kit ? kit.nome || "produto escolhido" : kits.length ? `${kits.length} ${kits.length === 1 ? "produto" : "produtos"}` : "nenhum ainda";

  return (
    <section className={coluna ? "min-w-0 p-0.5" : "min-w-0 border-t border-border pt-4"} aria-label="O produto" data-produto-das-fotos="" data-coluna={coluna ? "" : undefined} data-recolhido={recolhido ? "sim" : "nao"}>
      <div className={recolhido ? "flex min-w-0 flex-wrap items-center justify-between" : "mb-2.5 flex min-w-0 flex-wrap items-center justify-between"}>
        <div className="mr-2 flex min-w-0 flex-1 items-center">
          <TituloRecolhivel titulo="O produto" recolhido={recolhido} onAlternar={() => setRecolhido(!recolhido)} resumo={resumo} />
          {!recolhido && <AjudaRecolhida className="ml-1.5" rotulo="Como o produto é identificado">
            {kits.length
              ? "Escolha o produto das fotos e confirme. A identificação já montou tudo: fotos, referências e o que não pode mudar."
              : "Toque em Identificar: a leitura acha marca, modelo e variante pela embalagem ou pela foto, busca as fotos oficiais e monta o produto sozinha."}
          </AjudaRecolhida>}
          {!recolhido && kits.length > 0 && <span className="ml-2 text-[12px] tabular-nums text-muted-foreground">{kits.length}</span>}
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
      {!recolhido && (
      <>
      {!selecionadas.length && paraLer.length > 0 && !kits.length && (
        <p className="mb-2 truncate text-[12px] text-muted-foreground" title="Marque as fotos da embalagem para escolher quais ler.">Sem foto marcada, lê as {paraLer.length} originais mais recentes.</p>
      )}

      {kits.length > 0 && (
        // 28/09: sem rolagem própria aqui dentro; quem rola é o topo da etapa (uma rolagem por região).
        <div className="min-w-0">
          <ul className={coluna ? "grid min-w-0 grid-cols-1 gap-1.5" : "grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3"}>
            {kits.map((k) => (
              <ChipDoProduto key={String(k.id)} kit={k} capa={capaDe(k)} ativo={k.id === kitId} onEscolher={() => escolherKit(k.id)} grande={coluna} />
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
          {/* Com o objetivo que pede o produto, o "seguir" já está na faixa do passo (GuiaDaLinha), no alto. */}
          {/* 02/10 (dono: "fica em laço"): daqui só para frente, direto na ferramenta, já com este produto. */}
          {!(objetivo && objetivo.requisito === "produto") && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mb-1 mr-1.5 h-8 text-[12px]"
                onClick={() => {
                  if (escolherObjetivo) escolherObjetivo("variacoes");
                  irPara("ensaio");
                }}
                data-criar-deste-produto="variacoes"
              >
                <Images className="mr-1.5 h-3.5 w-3.5" /> Fotos do produto
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mb-1 mr-2 h-8 text-[12px]"
                onClick={() => {
                  if (escolherObjetivo) escolherObjetivo("modelo");
                  irPara("campanha");
                }}
                data-criar-deste-produto="modelo"
              >
                <Megaphone className="mr-1.5 h-3.5 w-3.5" /> Foto com modelo
              </Button>
            </>
          )}
          <button type="button" className="mb-1 text-[12px] text-muted-foreground hover:text-foreground" onClick={() => irPara("kits", { kit: kit.id })}>
            Detalhes do produto
          </button>
        </div>
      )}
      </>
      )}
    </section>
  );
}
