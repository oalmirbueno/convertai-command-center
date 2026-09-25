import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ClipboardCheck, Loader2, Megaphone, PenTool } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Ampliar } from "@/components/mesa/Ampliar";
import { AvisoDeErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { BotoesDeUso } from "./AcoesDeUso";
import { Cartao, MiniaturaDaFoto, Moldura, Pilulas, SeloCurto, useMesaFoto, Vazio } from "./Comuns";
import { DecisaoRapida, MenuDeUso, useLevarParaAsMesas } from "./UsoDaFoto";
import { classeDaFoto, fotosParaRevisar, proporcaoDoFormato, useEnsaios, useFotos, type FotoDoAcervo } from "./fotoApi";

/**
 * Passo 3, Usar (com a revisão dentro): em cima, as fotos geradas que ainda
 * esperam decisão (aprovar ou rejeitar ali mesmo, ou "Aprovar e usar"); em
 * baixo, as prontas, cada uma com o menu Usar (Mesa, Mesa Ads, Baixar,
 * Mandar para aprovação, Arquivos) e as ações do grupo marcado.
 *
 * A foto aprovada já está no acervo único do cliente (cliente_imagens,
 * origem mesa_foto): "Usar na Mesa" abre o Estúdio com as fotos no endereço
 * (&fotos=), que as mostra em "Fotos que vieram da Mesa Foto". Aprovar a foto
 * não aprova a arte ou o anúncio feito com ela.
 */

export { chaveDasFotosParaUsar, enderecoParaUsar, guardarFotosParaUsar } from "./UsoDaFoto";

type Origem = "aprovadas" | "ensaio" | "todas_tratadas";

/** Revisar sem trocar de tela: a última versão de cada tomada ainda sem decisão. */
function ParaRevisar() {
  const { clientId } = useMesa();
  const { ensaioId, irPara } = useMesaFoto();
  const ensaios = useEnsaios(clientId);
  const pendentes = useMemo(() => fotosParaRevisar(ensaios.data || [], ensaioId), [ensaios.data, ensaioId]);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  if (!pendentes.length) return null;
  return (
    <Cartao
      titulo={`Para revisar · ${pendentes.length}`}
      dica="Fotos geradas esperando a decisão da equipe. Aprovar põe a foto no acervo, pronta para a Mesa e a Mesa Ads."
      acao={
        <Button type="button" size="sm" variant="ghost" className="h-8 text-[12px]" onClick={() => irPara("revisar", { ensaio: pendentes[0].ensaio.id })}>
          <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Comparar com as fontes
        </Button>
      }
    >
      <div className="max-h-[60vh] min-w-0 overflow-y-auto pr-0.5" data-rolagem-propria="">
        <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-para-revisar="">
          {pendentes.map((p, i) => (
            <li key={`${p.ensaio.id}-${p.tomada.id}-${p.versao.versao}`} className="min-w-0 rounded-xl border border-border bg-card p-1.5" data-pendente={p.tomada.id}>
              <button type="button" className="block w-full cursor-zoom-in" onClick={() => setAmpliada(i)} aria-label={`Ver grande: ${p.tomada.nome}`}>
                <Moldura proporcao={proporcaoDoFormato(p.tomada.formato)} className="border border-border">
                  <ImagemDaMesa caminho={p.versao.storage_path || ""} alt={p.tomada.nome} className="h-full w-full !object-contain" />
                  <span className="pointer-events-none absolute left-1 top-1 rounded-full border border-primary/30 bg-card px-1.5 py-px text-[9.5px] font-semibold text-primary" data-selo="gerada">
                    gerada
                  </span>
                </Moldura>
              </button>
              <p className="mt-1 truncate px-0.5 text-[11.5px] font-medium" title={p.tomada.nome}>
                {p.tomada.nome} <span className="font-normal text-muted-foreground">v{p.versao.versao}</span>
              </p>
              <div className="mt-1 flex min-w-0 flex-wrap items-center">
                <DecisaoRapida ensaio={p.ensaio} tomada={p.tomada} versao={p.versao} compacta />
                <MenuDeUso pendente={p} variante="outline" className="mb-1" />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <Ampliar
        imagens={pendentes.map((p) => ({ caminho: p.versao.storage_path || "", titulo: `${p.tomada.nome}, v${p.versao.versao} (gerada)`, legenda: "Imagem gerada por IA", proporcao: proporcaoDoFormato(p.tomada.formato) }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </Cartao>
  );
}

export default function EtapaUsar() {
  const { clientId } = useMesa();
  const { ensaioId, irPara } = useMesaFoto();
  const levar = useLevarParaAsMesas();
  const fotos = useFotos(clientId);
  const ensaios = useEnsaios(clientId);
  const todas = useMemo(() => fotos.data || [], [fotos.data]);
  const ensaio = ensaioId ? (ensaios.data || []).find((e) => e.id === ensaioId) || null : null;
  const [origem, setOrigem] = useState<Origem>(ensaio ? "ensaio" : "aprovadas");
  const [marcadas, setMarcadas] = useState<string[] | null>(null);
  const [ampliada, setAmpliada] = useState<number | null>(null);

  const idsDoEnsaio = useMemo(() => {
    const ids: string[] = [];
    if (ensaio) {
      for (const t of ensaio.tomadas) {
        for (const v of t.versoes) if (v.aprovada && v.imagem_id) ids.push(v.imagem_id);
      }
    }
    return ids;
  }, [ensaio]);

  const lista: FotoDoAcervo[] = useMemo(() => {
    if (origem === "ensaio") return todas.filter((f) => idsDoEnsaio.indexOf(f.id) >= 0 || (f.aprovada && ensaio && f.kit_id === ensaio.kit_id && classeDaFoto(f) === "gerada"));
    if (origem === "todas_tratadas") return todas.filter((f) => f.aprovada || classeDaFoto(f) === "derivada");
    return todas.filter((f) => f.aprovada);
  }, [todas, origem, idsDoEnsaio, ensaio]);

  // Começa com todas as da lista marcadas; trocar a lista marca de novo.
  useEffect(() => setMarcadas(null), [origem]);
  const escolhidasIds = marcadas === null ? lista.map((f) => f.id) : marcadas.filter((id) => lista.some((f) => f.id === id));
  const escolhidas = lista.filter((f) => escolhidasIds.indexOf(f.id) >= 0);
  const geradas = escolhidas.filter((f) => classeDaFoto(f) === "gerada").length;

  const alternar = (id: string) => {
    const base = escolhidasIds;
    setMarcadas(base.indexOf(id) >= 0 ? base.filter((x) => x !== id) : base.concat([id]));
  };

  const opcoes: { valor: Origem; rotulo: string }[] = [{ valor: "aprovadas", rotulo: "Todas as aprovadas" }];
  if (ensaio) opcoes.push({ valor: "ensaio", rotulo: "Deste ensaio" });
  opcoes.push({ valor: "todas_tratadas", rotulo: "Aprovadas e tratadas" });

  return (
    <div className="min-w-0 space-y-4 pb-24">
      <ParaRevisar />

      <Cartao
        titulo="Prontas para usar"
        dica="Cada foto tem o menu Usar. Marque várias para levar juntas. Aprovar a foto não aprova a arte ou o anúncio feito com ela; foto gerada sai sempre marcada."
        acao={<Pilulas rotulo="Quais fotos" opcoes={opcoes} valor={origem} onEscolher={setOrigem} />}
      >
        {fotos.isLoading && (
          <p className="flex items-center text-[12px] text-muted-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Lendo o acervo...
          </p>
        )}
        {fotos.isError && <AvisoDeErro erro={fotos.error} />}
        {fotos.isSuccess && lista.length === 0 && (
          <Vazio
            titulo="Nenhuma foto aprovada aqui"
            acao={
              <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => irPara("criar")}>
                Criar fotos
              </Button>
            }
          >
            Aprove as fotos geradas em Para revisar (acima) ou no resultado de Variações e Campanha.
          </Vazio>
        )}
        {lista.length > 0 && (
          <>
            <div className="mb-2 flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground">
              <span className="mr-3">
                {escolhidas.length} de {lista.length} {lista.length === 1 ? "marcada" : "marcadas"}
                {geradas ? ` · ${geradas} ${geradas === 1 ? "gerada" : "geradas"}` : ""}
              </span>
              <button type="button" className="mr-3 font-medium text-primary hover:underline" onClick={() => setMarcadas(lista.map((f) => f.id))}>
                Marcar todas
              </button>
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setMarcadas([])}>
                Desmarcar
              </button>
            </div>
            <div className="max-h-[70vh] min-w-0 overflow-y-auto pr-0.5" data-rolagem-propria="">
              <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {lista.map((f, i) => {
                  const marcada = escolhidasIds.indexOf(f.id) >= 0;
                  return (
                    <li key={f.id} className={`relative min-w-0 rounded-xl border bg-card p-1.5 ${marcada ? "border-primary" : "border-border"}`} data-pronta={f.id}>
                      <button type="button" className="block w-full min-w-0 text-left" onClick={() => setAmpliada(i)} aria-label={`Ver ${f.nome} grande`}>
                        <MiniaturaDaFoto foto={f} />
                      </button>
                      <span className="mt-1 block truncate px-0.5 text-[11.5px] font-medium" title={f.nome}>
                        {f.nome}
                      </span>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center justify-between">
                        <SeloCurto foto={f} />
                        <MenuDeUso foto={f} variante="outline" />
                      </div>
                      <label className="absolute right-2.5 top-2.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-border bg-card shadow-sm">
                        <input type="checkbox" checked={marcada} onChange={() => alternar(f.id)} className="h-3.5 w-3.5" aria-label={`Marcar ${f.nome}`} />
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </Cartao>

      {lista.length > 0 && (
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <Cartao titulo={`Usar nas mesas · ${escolhidas.length} ${escolhidas.length === 1 ? "marcada" : "marcadas"}`} dica="A foto entra no Estúdio pelo acervo, sem upload de novo.">
            <div className="flex min-w-0 flex-wrap">
              <Button type="button" size="sm" className="mb-1.5 mr-1.5 h-8 text-[12px]" disabled={!escolhidas.length} onClick={() => levar("mesa", escolhidas)}>
                <PenTool className="mr-1.5 h-3.5 w-3.5" /> Usar na Mesa <ArrowUpRight className="ml-1 h-3 w-3" />
              </Button>
              <Button type="button" size="sm" variant="outline" className="mb-1.5 h-8 text-[12px]" disabled={!escolhidas.length} onClick={() => levar("ads", escolhidas)}>
                <Megaphone className="mr-1.5 h-3.5 w-3.5" /> Usar na Mesa Ads <ArrowUpRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </Cartao>
          <Cartao titulo="Levar para fora">
            <BotoesDeUso fotos={escolhidas} />
          </Cartao>
        </div>
      )}

      <Ampliar
        imagens={lista.map((f) => ({
          caminho: f.storage_path,
          bucket: f.storage_bucket || "mesa",
          titulo: f.nome,
          legenda: classeDaFoto(f) === "gerada" ? "Imagem gerada por IA" : undefined,
          proporcao: f.largura && f.altura ? f.largura / f.altura : undefined,
        }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </div>
  );
}
