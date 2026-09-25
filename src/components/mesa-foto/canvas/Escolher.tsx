import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ImagePlus, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro } from "@/lib/mesa/api";
import { Moldura, useMesaFoto } from "../Comuns";
import { acrescentarFotos, invalidarFotos, rotuloDoTipo, subirOriginais } from "../fotoApi";
import { STATUS_DA_PERSONA } from "../modelosApi";
import { TIPOS_DE_NO, type DadosDoNo, type ModoDoAmbiente } from "../canvasApi";
import { BOTAO, CAMPO, capaDoKit, daFoto, Escolha, ICONES, kitsUsaveis, MiniaturaGrande, personaSemAncora, ROTULO, rostoDaPersona, type Fontes, type Miniatura } from "./comum";

/**
 * Escolha com miniatura do que vai num cartão (v3: janela menor e preta).
 * Produto (kits deste cliente; de outros clientes, pela esteira), Pessoa
 * (modelo sintética ou foto real com autorização), Ambiente (descrever, foto
 * usada como está ou complementada, ou pelo contexto) e Estilo. Dá para
 * mandar foto nova daqui: ela entra no acervo do cliente como original.
 */

export type AbaDaEscolha = "produto" | "modelo" | "ambiente" | "estilo";
export const ABAS_DA_ESCOLHA: AbaDaEscolha[] = ["produto", "modelo", "ambiente", "estilo"];

export interface PedidoDeEscolha {
  tipo: AbaDaEscolha;
  /** Cartão a trocar; null põe um cartão novo no quadro. */
  trocarId: string | null;
}

function Opcao({ miniatura, titulo, subtitulo, aviso, desligada, onEscolher, atributo }: { miniatura: Miniatura | null; titulo: string; subtitulo?: string; aviso?: string; desligada?: boolean; onEscolher: () => void; atributo: string }) {
  return (
    <button
      type="button"
      disabled={desligada}
      onClick={onEscolher}
      data-opcao-da-escolha={atributo}
      className={`min-w-0 rounded-lg border p-1 text-left transition-colors ${desligada ? "cursor-not-allowed border-dashed border-white/10 opacity-60" : "border-white/10 bg-white/[0.03] hover:border-emerald-400/60"}`}
    >
      <Moldura proporcao={1} className="!rounded-md !bg-zinc-900">
        {miniatura ? <MiniaturaGrande m={miniatura} alt={titulo} /> : <span className="flex h-full w-full items-center justify-center text-[10px] text-zinc-500">sem foto</span>}
      </Moldura>
      <p className="mt-1 truncate text-[11px] font-medium text-zinc-100">{titulo}</p>
      {subtitulo && <p className="truncate text-[10px] text-zinc-400">{subtitulo}</p>}
      {aviso && <p className="truncate text-[10px] text-amber-300">{aviso}</p>}
    </button>
  );
}

/** Mandar foto nova ao acervo (original, como veio) e já usar no cartão. */
function MandarFoto({ onPronta, rotulo }: { onPronta: (imagemId: string) => void; rotulo: string }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const enviar = async (lista: FileList | null) => {
    const arquivos = lista ? Array.prototype.slice.call(lista, 0, 1) as File[] : [];
    if (!arquivos.length) return;
    setEnviando(true);
    try {
      const r = await subirOriginais(clientId, arquivos, () => undefined);
      if (r.registradas.length) {
        acrescentarFotos(queryClient, clientId, r.registradas);
        invalidarFotos(queryClient, clientId);
        onPronta(r.registradas[0].id);
      } else {
        toast.error("Foto não entrou no acervo", { description: r.recusadas.length ? `${r.recusadas[0].nome}: ${r.recusadas[0].motivo}` : r.duplicadas ? "Ela já está no acervo: escolha na lista." : undefined });
      }
    } catch (e) {
      toast.error("Foto não enviada", { description: textoDoErro(e) });
    } finally {
      setEnviando(false);
      if (entrada.current) entrada.current.value = "";
    }
  };
  return (
    <>
      <input ref={entrada} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void enviar(e.target.files)} aria-label={rotulo} />
      <button type="button" className={BOTAO} disabled={enviando} onClick={() => entrada.current && entrada.current.click()}>
        {enviando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />} {rotulo}
      </button>
    </>
  );
}

export function EscolherCartao({
  pedido,
  fontes,
  onFechar,
  onEscolher,
}: {
  pedido: PedidoDeEscolha | null;
  fontes: Fontes;
  onFechar: () => void;
  onEscolher: (tipo: AbaDaEscolha, dados: DadosDoNo, trocarId: string | null) => void;
}) {
  const { irPara } = useMesaFoto();
  const [aba, setAba] = useState<AbaDaEscolha>("produto");
  const [texto, setTexto] = useState("");
  const [busca, setBusca] = useState("");
  const [modo, setModo] = useState<ModoDoAmbiente>("foto");
  const [usoDaFoto, setUsoDaFoto] = useState<"usar" | "complementar">("complementar");
  const [pessoaReal, setPessoaReal] = useState(false);
  const [autorizada, setAutorizada] = useState(false);
  useEffect(() => {
    if (!pedido) return;
    setAba(pedido.tipo);
    setTexto("");
    setBusca("");
    setModo("foto");
    setPessoaReal(false);
    setAutorizada(false);
  }, [pedido]);
  const trocando = !!(pedido && pedido.trocarId);
  const escolher = (dados: DadosDoNo) => {
    if (!pedido) return;
    onEscolher(aba, dados, pedido.trocarId);
    onFechar();
  };
  const kits = kitsUsaveis(fontes.kits);
  const personas = fontes.personas.filter((p) => p.status !== "arquivada");
  const referencias = fontes.biblioteca.filter((i) => i.tipo === "referencia");
  const termo = busca.trim().toLowerCase();
  const fotos = fontes.fotos.filter((f) => !termo || String(f.nome || "").toLowerCase().indexOf(termo) >= 0).slice(0, 36);
  const tipo = TIPOS_DE_NO[aba];
  const grade = "grid min-w-0 grid-cols-4 gap-1.5 sm:grid-cols-6";

  const fotosDoAcervo = (onFoto: (id: string) => void, rotuloDoEnvio: string) => (
    <div className="min-w-0">
      <div className="mb-1.5 flex min-w-0 flex-wrap items-center">
        <p className={`${ROTULO} mb-0 mr-2 min-w-0 flex-1`}>Fotos do acervo</p>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome" aria-label="Buscar foto do acervo" className={`${CAMPO} mb-1 mr-1.5 h-7 !w-40 !py-1 text-[11.5px]`} />
        <MandarFoto rotulo={rotuloDoEnvio} onPronta={onFoto} />
      </div>
      {fotos.length ? (
        <div className={grade} aria-label="Fotos do acervo">
          {fotos.map((f) => (
            <Opcao key={f.id} atributo={f.id} miniatura={daFoto(f)} titulo={f.nome} onEscolher={() => onFoto(f.id)} />
          ))}
        </div>
      ) : (
        <p className="text-[11.5px] text-zinc-400">Nenhuma foto no acervo{termo ? " com esse nome" : ""}. Mande uma pelo botão.</p>
      )}
    </div>
  );

  return (
    <Dialog open={!!pedido} onOpenChange={(v) => (!v ? onFechar() : undefined)}>
      <DialogContent className="dark max-h-[82vh] max-w-xl overflow-y-auto border-white/10 bg-zinc-950 p-4 text-zinc-100" data-escolher-cartao={aba}>
        <DialogHeader>
          <DialogTitle className="text-[14px]">{trocando ? `Trocar ${tipo.rotulo.toLowerCase()}` : "Pôr no quadro"}</DialogTitle>
          <DialogDescription className="text-[11.5px] text-zinc-400">{trocando ? tipo.dica : "Escolha pela foto. O cartão entra já ligado ao Resultado."}</DialogDescription>
        </DialogHeader>
        {!trocando && (
          <div className="flex min-w-0 flex-wrap items-center" role="tablist" aria-label="O que pôr no quadro">
            {ABAS_DA_ESCOLHA.map((a) => {
              const t = TIPOS_DE_NO[a];
              const Icone = ICONES[a];
              return (
                <button
                  key={a}
                  type="button"
                  role="tab"
                  aria-selected={aba === a}
                  onClick={() => setAba(a)}
                  className={`mb-1 mr-1 inline-flex h-8 items-center rounded-full border px-2.5 text-[12px] ${aba === a ? `${t.borda} ${t.fundo} text-white` : "border-white/10 text-zinc-400 hover:text-white"}`}
                >
                  <Icone className={`mr-1.5 h-3.5 w-3.5 ${t.texto}`} /> {t.rotulo}
                </button>
              );
            })}
          </div>
        )}

        {aba === "produto" && (
          <div className="min-w-0 space-y-2">
            {kits.length ? (
              <div className={grade} aria-label="Produtos do cliente">
                {kits.map((k) => (
                  <Opcao key={String(k.id)} atributo={String(k.id)} miniatura={capaDoKit(k, fontes.fotos)} titulo={k.nome} subtitulo={`${rotuloDoTipo(k.tipo)}${k.variante ? ` · ${k.variante}` : ""}`} onEscolher={() => escolher({ kit_id: String(k.id), titulo: k.nome })} />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-white/15 p-4 text-center">
                <p className="text-[12.5px] font-medium">Nenhum produto confirmado neste cliente.</p>
                <p className="mt-1 text-[11.5px] text-zinc-400">O produto nasce no passo Produto, a partir das fotos.</p>
                <button type="button" className={`${BOTAO} mt-2`} onClick={() => { onFechar(); irPara("kits"); }}>
                  Ir para Produto
                </button>
              </div>
            )}
            <p className="text-[10.5px] text-zinc-500">Produto de outro cliente: arraste da esteira no topo do quadro.</p>
          </div>
        )}

        {aba === "modelo" && (
          <div className="min-w-0 space-y-3">
            <Escolha
              rotulo="Tipo de pessoa"
              opcoes={[
                { valor: "modelo", rotulo: "Modelo sintética" },
                { valor: "real", rotulo: "Foto real" },
              ]}
              valor={pessoaReal ? "real" : "modelo"}
              onEscolher={(v) => setPessoaReal(v === "real")}
            />
            {!pessoaReal ? (
              personas.length ? (
                <div className={grade} aria-label="Modelos">
                  {personas.map((p) => (
                    <Opcao
                      key={p.id}
                      atributo={p.id}
                      miniatura={rostoDaPersona(p, fontes.ancoras)}
                      titulo={p.nome}
                      subtitulo={STATUS_DA_PERSONA[p.status].rotulo}
                      aviso={personaSemAncora(p) ? "sem âncora" : undefined}
                      desligada={personaSemAncora(p)}
                      onEscolher={() => escolher({ modelo_id: p.id, versao: p.versao, imagem_id: null, autorizada: false })}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-white/15 p-4 text-center">
                  <p className="text-[12.5px] font-medium">Nenhuma modelo ainda.</p>
                  <button type="button" className={`${BOTAO} mt-2`} onClick={() => { onFechar(); irPara("modelos"); }}>
                    Ir para Modelos
                  </button>
                </div>
              )
            ) : (
              <div className="min-w-0 space-y-2">
                <label className="flex items-start rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-[11.5px] leading-snug text-amber-100">
                  <input type="checkbox" className="mr-2 mt-0.5" checked={autorizada} onChange={(e) => setAutorizada(e.target.checked)} aria-label="Tenho autorização desta pessoa" />
                  Tenho autorização desta pessoa para usar a imagem dela em foto gerada (sem autorização, o cartão não gera).
                </label>
                {fotosDoAcervo((id) => escolher({ imagem_id: id, modelo_id: null, versao: null, autorizada }), "Mandar foto da pessoa")}
              </div>
            )}
          </div>
        )}

        {aba === "ambiente" && (
          <div className="min-w-0 space-y-3">
            <Escolha
              rotulo="Como montar o ambiente"
              opcoes={[
                { valor: "foto", rotulo: "Pela foto", dica: "Uma foto do lugar (uma loja, por exemplo)." },
                { valor: "descrever", rotulo: "Descrever", dica: "Em palavras: lugar, luz e clima." },
                { valor: "contexto", rotulo: "Pelo contexto", dica: "O lugar sai da marca, do nicho e da campanha do cliente." },
              ]}
              valor={modo}
              onEscolher={(v) => setModo(v as ModoDoAmbiente)}
            />
            {modo === "foto" && (
              <div className="min-w-0 space-y-2">
                <Escolha
                  rotulo="Uso da foto do lugar"
                  opcoes={[
                    { valor: "complementar", rotulo: "Complementar", dica: "Parte do lugar e completa o que faltar, ambientado e realista." },
                    { valor: "usar", rotulo: "Usar como está", dica: "O lugar real vira o cenário." },
                  ]}
                  valor={usoDaFoto}
                  onEscolher={(v) => setUsoDaFoto(v as "usar" | "complementar")}
                />
                {fotosDoAcervo((id) => escolher({ modo: "foto", uso: usoDaFoto, imagem_id: id, biblioteca_id: null }), "Mandar foto do lugar")}
              </div>
            )}
            {modo === "descrever" && (
              <div className="min-w-0">
                <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Ex.: praia no fim de tarde, loja com balcão de madeira clara" aria-label="Descrição do ambiente" className={CAMPO} />
                <button type="button" className={`${BOTAO} mt-2`} disabled={!texto.trim()} onClick={() => escolher({ modo: "descrever", texto: texto.trim(), imagem_id: null, biblioteca_id: null })}>
                  <Check className="mr-1 h-3.5 w-3.5" /> {trocando ? "Usar esta descrição" : "Pôr no quadro"}
                </button>
              </div>
            )}
            {modo === "contexto" && (
              <div className="min-w-0 rounded-lg border border-white/10 p-3">
                <p className="text-[12px] leading-snug text-zinc-300">O lugar sai da marca (estilo e paleta), do nicho e da campanha do cliente, sem custo. Para uma descrição escrita pelo agente, use o botão do cartão depois.</p>
                <button type="button" className={`${BOTAO} mt-2`} onClick={() => escolher({ modo: "contexto", texto: "", imagem_id: null, biblioteca_id: null })}>
                  <Check className="mr-1 h-3.5 w-3.5" /> Usar o contexto do cliente
                </button>
              </div>
            )}
          </div>
        )}

        {aba === "estilo" && (
          <div className="min-w-0 space-y-3">
            <div className="min-w-0">
              <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Ex.: luz de estúdio fria, céu azul limpo, cores quentes" aria-label="Descrição do estilo" className={CAMPO} />
              <button type="button" className={`${BOTAO} mt-2`} disabled={!texto.trim()} onClick={() => escolher({ texto: texto.trim() })}>
                <Check className="mr-1 h-3.5 w-3.5" /> {trocando ? "Usar esta descrição" : "Pôr no quadro"}
              </button>
            </div>
            {referencias.length > 0 && (
              <div className="min-w-0">
                <p className={ROTULO}>Referências da biblioteca</p>
                <div className={grade} aria-label="Referências da biblioteca">
                  {referencias.slice(0, 24).map((i) => (
                    <Opcao key={i.id} atributo={i.id} miniatura={{ caminho: "", bucket: "mesa", item: i }} titulo={i.titulo} onEscolher={() => escolher({ biblioteca_id: i.id, imagem_id: null })} />
                  ))}
                </div>
              </div>
            )}
            {fotosDoAcervo((id) => escolher({ imagem_id: id, biblioteca_id: null }), "Mandar referência")}
            <p className="text-[10.5px] text-zinc-500">Só paleta, luz e enquadramento. Estilo nunca vira identidade.</p>
          </div>
        )}
        <p className="flex items-center text-[10.5px] text-zinc-500">
          <ImagePlus className="mr-1 h-3 w-3" /> Foto mandada daqui entra no acervo do cliente como original.
        </p>
      </DialogContent>
    </Dialog>
  );
}
