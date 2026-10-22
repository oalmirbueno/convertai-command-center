import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Check, ImagePlus, Loader2, Palette, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { padraoPara, TAMANHOS, textoDoErro, type ParteDaEstimativa } from "@/lib/mesa/api";
import { subirReferencia } from "@/lib/mesa/referencias";
import { botao, juntar, texto } from "@/components/sistema";
import { BotaoComCusto } from "./Custo";
import { ImagemDaMesa, useMarcaDaMesa, useMesa } from "./MesaContexto";
import type { Campanha } from "./mesaV4Api";
import SeletorDeReferencias, { MiniaturasEscolhidas } from "./SeletorDeReferencias";
import EstudioReferenciaNaHora from "./EstudioReferenciaNaHora";
import { chavesDaCampanhaCompleta, definirPadraoDaCampanha, padraoDaCampanha, partesDoPadrao, prepararPecaSemGerar, trocarCampanhaNoCache } from "./campanhasApi";
import { corpoDaPeca, ehPecaDeArte, type SituacaoDaPeca } from "./regrasDaCampanha";
import { MAX_REFERENCIAS_DO_PADRAO } from "../../../supabase/functions/_shared/padrao-da-campanha";

/**
 * Referência da campanha (22/10/2026, dono: "a campanha seguir referência de post, onde eu escolho e ele faz os
 * posts já nessa pegada no Estúdio, para ter um padrão único de campanha"). A equipe escolhe 1 a 3 posts:
 * das Referências do Estúdio (cliente, workspace, banco da agência, Pinterest), enviando ou colando imagem ou
 * link (o mesmo "Referência na hora" do Estúdio) ou de uma peça já gerada da campanha. "Ler o padrão" faz UMA
 * leitura por visão e grava o padrão visual na campanha; toda peça e o selo passam a segui-lo, com as
 * referências anexadas ao gerador como estilo (nada colado, nada copiado).
 */

const juntarAte3 = (lista: string[], id: string) => lista.filter((x) => x !== id).concat([id]).slice(-MAX_REFERENCIAS_DO_PADRAO);

export default function CampanhaReferenciaPadrao({ campanha, pecas = [], compacto = false }: { campanha: Campanha; pecas?: SituacaoDaPeca[]; compacto?: boolean }) {
  const { clientId, catalogo } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const padrao = padraoDaCampanha(campanha);
  const [editando, setEditando] = useState(false);
  const [escolhidas, setEscolhidas] = useState<string[]>(padrao ? padrao.referencias_ids : []);
  const [galeria, setGaleria] = useState(false);
  const [subindo, setSubindo] = useState(false);
  const prontas = pecas.filter((p) => p.capa && (p.estado === "pronta" || p.estado === "na_agenda")).slice(0, 8);
  const aFazer = pecas.filter((p) => ehPecaDeArte(p.item) && p.estado === "a_fazer");
  const diretor = padraoPara(catalogo, "diretor_arte");
  const imagem = padraoPara(catalogo, "imagem");
  const marcaId = (campanha.identidade && campanha.identidade.marca_id) || (marca ? marca.id : null);

  const daPeca = async (caminho: string) => {
    setSubindo(true);
    try {
      const { data, error } = await supabase.storage.from("mesa").download(caminho);
      if (error || !data) throw error || new Error("A arte não abriu.");
      const tipo = data.type && data.type.indexOf("image/") === 0 ? data.type : "image/png";
      const id = await subirReferencia(clientId, new File([data], `peca-da-campanha.${tipo === "image/jpeg" ? "jpg" : tipo.split("/")[1] || "png"}`, { type: tipo }));
      setEscolhidas((l) => juntarAte3(l, id));
    } catch (e) {
      toast.error("A peça não virou referência", { description: textoDoErro(e) });
    } finally {
      setSubindo(false);
    }
  };

  const ler = async () => {
    const r = await definirPadraoDaCampanha(campanha.id, escolhidas);
    if (r && r.campanha) trocarCampanhaNoCache(qc, clientId, r.campanha);
    setEditando(false);
    setGaleria(false);
    return r;
  };

  const tirar = async () => {
    try {
      const r = await definirPadraoDaCampanha(campanha.id, []);
      if (r && r.campanha) trocarCampanhaNoCache(qc, clientId, r.campanha);
      setEscolhidas([]);
      toast.success("Padrão tirado", { description: "As próximas peças seguem só a identidade da campanha." });
    } catch (e) {
      toast.error("Padrão não tirado", { description: textoDoErro(e) });
    }
  };

  const aplicarNasQueFaltam = async () => {
    const deArte = pecas.filter((p) => ehPecaDeArte(p.item));
    let feitas = 0;
    const falhas: string[] = [];
    for (const p of aFazer) {
      try {
        await prepararPecaSemGerar(corpoDaPeca({ clientId, campanha, item: p.item, posicao: { i: deArte.indexOf(p) + 1, total: deArte.length }, marcaId, modeloImagemId: imagem ? imagem.id : null }));
        feitas += 1;
      } catch (e) {
        falhas.push(`${p.item.tema || "Peça"}: ${textoDoErro(e)}`);
      }
    }
    void qc.invalidateQueries({ queryKey: chavesDaCampanhaCompleta.pecas(clientId, campanha.id) });
    if (falhas.length) toast.warning(`${feitas} de ${aFazer.length} peças com o padrão`, { description: falhas.join(" ").slice(0, 300) });
    return { custo_usd: null };
  };

  // Resumo do padrão (visão da campanha e topo da Identidade).
  if (padrao && !editando) {
    return (
      <div className="min-w-0" data-padrao-da-campanha="">
        <div className="flex min-w-0 items-start">
          <Palette className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">Padrão visual da campanha</p>
            <p className={juntar(texto.auxiliar, "mt-0.5 [overflow-wrap:anywhere]")}>{padrao.resumo}</p>
            {padrao.paleta.length > 0 && (
              <span className="mt-1.5 flex" aria-label="Paleta do padrão">
                {padrao.paleta.map((c, i) => <span key={`${c.hex}-${i}`} className="mr-1 inline-block h-4 w-4 rounded-full border border-border" style={{ backgroundColor: c.hex }} title={`${c.nome || "cor"} ${c.hex}`} />)}
              </span>
            )}
          </div>
          <button type="button" className={botao.icone} onClick={() => { setEscolhidas(padrao.referencias_ids); setEditando(true); }} aria-label="Trocar a referência da campanha" title="Trocar a referência da campanha">
            <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
          </button>
          {!compacto && (
            <button type="button" className={botao.icone} onClick={() => void tirar()} aria-label="Tirar o padrão" title="Tirar o padrão visual da campanha">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="mt-2">
          <MiniaturasEscolhidas ids={padrao.referencias_ids} colunas={5} />
        </div>
        {aFazer.length > 0 && (
          <div className="mt-2 flex min-w-0 items-center">
            <p className={juntar(texto.auxiliar, "min-w-0 flex-1")}>{aFazer.length} {aFazer.length === 1 ? "peça ainda sem direção" : "peças ainda sem direção"}</p>
            <BotaoComCusto
              rotulo={<><Wand2 className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Aplicar às peças que faltam</span></>}
              titulo="Padrão nas peças"
              descricao="Aplicar às peças que faltam: cria a direção de cada uma no padrão (sem gerar; gerar fica no Estúdio)"
              partes={(): ParteDaEstimativa[] => [{ modeloId: diretor ? diretor.id : null, tipo: "texto", tokensEntrada: TAMANHOS.preparar.entrada, tokensSaida: TAMANHOS.preparar.saida, vezes: aFazer.length }]}
              executar={aplicarNasQueFaltam}
              fecharAoConfirmar
              sempreConfirmar
              variant="ghost"
              className="h-8 gap-0 px-2"
            />
          </div>
        )}
      </div>
    );
  }

  if (compacto && !editando) {
    return (
      <div className="flex min-w-0 items-center" data-padrao-da-campanha="vazio">
        <Palette className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>Sem referência da campanha</span>
        <button type="button" className={botao.icone} onClick={() => setEditando(true)} aria-label="Escolher a referência da campanha" title="Escolher a referência da campanha (1 a 3 posts)">
          <BookmarkPlus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  }

  // Escolha: 1 a 3 referências, de onde vier, e a leitura do padrão (custo antes).
  return (
    <div className="min-w-0 space-y-3" data-escolha-do-padrao="">
      <div className="flex min-w-0 items-center">
        <p className="min-w-0 flex-1 text-[13px] font-medium">
          Referência da campanha <span className="font-normal text-muted-foreground">({escolhidas.length} de {MAX_REFERENCIAS_DO_PADRAO})</span>
        </p>
        <button type="button" className={juntar(botao.icone, galeria && "bg-muted text-foreground")} aria-expanded={galeria} onClick={() => setGaleria((v) => !v)} aria-label={galeria ? "Fechar as Referências do Estúdio" : "Escolher nas Referências do Estúdio"} title={galeria ? "Fechar as Referências" : "Escolher nas Referências do Estúdio"}>
          {galeria ? <X className="h-4 w-4" aria-hidden="true" /> : <BookmarkPlus className="h-4 w-4" aria-hidden="true" />}
        </button>
        {(padrao || editando) && (
          <button type="button" className={botao.icone} onClick={() => { setEditando(false); setGaleria(false); }} aria-label="Fechar a escolha" title="Fechar a escolha">
            <Check className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <MiniaturasEscolhidas ids={escolhidas} colunas={5} onTirar={(id) => setEscolhidas((l) => l.filter((x) => x !== id))} vazio="Escolha 1 a 3 posts: o padrão de todas as peças." />
      {galeria && <SeletorDeReferencias selecionados={escolhidas} onChange={(ids) => setEscolhidas(ids.slice(0, MAX_REFERENCIAS_DO_PADRAO))} max={MAX_REFERENCIAS_DO_PADRAO} modo="escolher" colunas={6} alturaMax="420px" />}
      <EstudioReferenciaNaHora escolhidas={[]} onGravar={(ids) => { const novo = ids[ids.length - 1]; if (novo) setEscolhidas((l) => juntarAte3(l, novo)); }} alvoRotulo="campanha" compacto />
      {prontas.length > 0 && (
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>De uma peça já gerada</p>
          <ul className="flex min-w-0 flex-wrap" aria-label="Peças prontas para virar referência">
            {prontas.map((p) => (
              <li key={p.item.tema_id || p.capa || ""} className="mb-1.5 mr-1.5">
                <button type="button" className="block h-14 w-11 overflow-hidden rounded-md bg-muted ring-primary hover:ring-2 disabled:opacity-50" onClick={() => void daPeca(p.capa as string)} disabled={subindo || escolhidas.length >= MAX_REFERENCIAS_DO_PADRAO} aria-label={`Usar ${p.item.tema || "a peça"} como referência`} title={`Usar ${p.item.tema || "a peça"} como referência`}>
                  <ImagemDaMesa caminho={p.capa} alt="" className="h-full w-full" />
                </button>
              </li>
            ))}
            {subindo && <Loader2 className="ml-1 mt-4 h-4 w-4 animate-spin text-muted-foreground" aria-label="Guardando a referência" />}
          </ul>
        </div>
      )}
      <div className="flex min-w-0 items-center justify-end">
        <BotaoComCusto
          rotulo={<><ImagePlus className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Ler o padrão da referência</span></>}
          titulo="Padrão da campanha"
          descricao="Ler o padrão da referência uma vez (layout, hierarquia, tipografia, paleta, foto e elementos) e guardar na campanha"
          partes={() => partesDoPadrao(catalogo, escolhidas.length)}
          executar={ler}
          disabled={!escolhidas.length || subindo}
          className="h-9 gap-0 px-3"
        />
      </div>
    </div>
  );
}
