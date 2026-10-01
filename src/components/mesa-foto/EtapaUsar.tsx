import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, CalendarPlus, ClipboardCheck, Filter, Megaphone, PenTool } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Ampliar } from "@/components/mesa/Ampliar";
import { AvisoDeErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotoesDeUso } from "./AcoesDeUso";
import { Cartao, MiniaturaDaFoto, SeloCurto, useMesaFoto, Vazio } from "./Comuns";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import BarraDeAcoes from "@/components/sistema/BarraDeAcoes";
import { juntar, superficie } from "@/components/sistema/estilos";
import { Carregando } from "@/components/sistema/Estados";
import { MenuDeUso, precisaAprovar, useLevarParaAsMesas } from "./UsoDaFoto";
import { classeDaFoto, fotosParaRevisar, useEnsaios, useFotos, type FotoDoAcervo } from "./fotoApi";

/**
 * Passo 5, Usar (30/09, frente FTL: a revisão foi para o passo 4, Aprovar;
 * aqui fica a linha com o atalho): as prontas, cada uma com o menu Usar (Mesa, Mesa Ads, Baixar,
 * Mandar para aprovação, Arquivos) e as ações do grupo marcado.
 *
 * A foto aprovada já está no acervo único do cliente (cliente_imagens,
 * origem mesa_foto): "Usar na Mesa" abre o Estúdio com as fotos no endereço
 * (&fotos=), que as mostra em "Fotos que vieram da Mesa Foto". Aprovar a foto
 * não aprova a arte ou o anúncio feito com ela.
 *
 * 26/09 (sistema de design): blocos sem caixa, "Quais fotos" num seletor na
 * linha do título, as ações do grupo marcado numa barra só (Mesa, Mesa Ads,
 * baixar, aprovação, Arquivos) e rolagem própria só no computador.
 */

export { chaveDasFotosParaUsar, enderecoParaUsar, guardarFotosParaUsar } from "./UsoDaFoto";

type Origem = "aprovadas" | "ensaio" | "todas_tratadas";

/**
 * 30/09 (frente FTL): a revisão mudou para o passo 4 (Aprovar). Aqui fica só
 * uma linha com quantas esperam e o atalho para lá.
 */
function EsperandoAprovacao() {
  const { clientId } = useMesa();
  const { ensaioId, irPara } = useMesaFoto();
  const ensaios = useEnsaios(clientId);
  const fotos = useFotos(clientId);
  const n = useMemo(
    () => fotosParaRevisar(ensaios.data || [], ensaioId).length + (fotos.data || []).filter((f) => !f.referencia_web && precisaAprovar(f)).length,
    [ensaios.data, fotos.data, ensaioId],
  );
  if (!n) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center text-[13px]" data-esperando-aprovacao={n}>
      <ClipboardCheck className="mr-1.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="mr-2">
        {n} {n === 1 ? "foto gerada ainda espera" : "fotos geradas ainda esperam"} a aprovação da equipe.
      </span>
      <button type="button" className="rounded font-medium text-primary hover:underline" onClick={() => irPara("aprovar")}>
        Aprovar
      </button>
    </div>
  );
}

export default function EtapaUsar() {
  const { clientId } = useMesa();
  const { ensaioId, irPara, prepararNaAgenda } = useMesaFoto();
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
  if (ensaio) opcoes.push({ valor: "ensaio", rotulo: "Deste lote" });
  opcoes.push({ valor: "todas_tratadas", rotulo: "Aprovadas e tratadas" });

  return (
    <div className="min-w-0 space-y-5">
      <EsperandoAprovacao />

      <Cartao
        titulo="Prontas para usar"
        dica="Cada foto tem o menu Usar. Marque várias para levar juntas. Aprovar a foto não aprova a arte ou o anúncio feito com ela; foto gerada sai sempre marcada."
        acao={
          <>
            {/* 28/09: o atalho para os posts de fotos sai da linha própria e vem para a linha do título. */}
            {prepararNaAgenda && (
              <Button type="button" size="sm" variant="ghost" className="h-8 text-[12px]" onClick={() => irPara("agenda")} title="Posts de fotos: legenda, data e aprovação do cliente" data-atalho-da-agenda="">
                <CalendarPlus className="mr-1.5 h-3.5 w-3.5" /> Post na Agenda
              </Button>
            )}
            <SeletorCompacto modo="lista" rotulo="Quais fotos" icone={<Filter className="h-4 w-4" />} opcoes={opcoes} valor={origem} onEscolher={(v) => setOrigem(v as Origem)} />
          </>
        }
      >
        {fotos.isLoading && <Carregando forma="grade" linhas={6} rotulo="Lendo o acervo" />}
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
            Aprove as fotos geradas no passo 4 (Aprovar) ou no resultado de Fotos do produto e Foto com modelo.
          </Vazio>
        )}
        {lista.length > 0 && (
          <>
            <div className="mb-2 flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground">
              <span className="mr-3 tabular-nums">
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
            <div className="min-w-0">
              <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {lista.map((f, i) => {
                  const marcada = escolhidasIds.indexOf(f.id) >= 0;
                  return (
                    <li key={f.id} className={juntar(superficie.painel, "relative min-w-0 p-1.5", marcada && "border-primary")} data-pronta={f.id}>
                      <button type="button" className="block w-full min-w-0 text-left" onClick={() => setAmpliada(i)} aria-label={`Ver ${f.nome} grande`}>
                        <MiniaturaDaFoto foto={f} />
                      </button>
                      <span className="mt-1 block truncate px-0.5 text-[12px] font-medium" title={f.nome}>
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
        // Ações do grupo marcado numa barra só: Mesa, Mesa Ads e as saídas (baixar, aprovação, Arquivos).
        <BarraDeAcoes
          className="border-t border-border pt-3"
          inicio={
            <span className="tabular-nums" title="A foto entra no Estúdio pelo acervo, sem upload de novo.">
              Usar {escolhidas.length} {escolhidas.length === 1 ? "marcada" : "marcadas"}
            </span>
          }
        >
          {/* Frente MF (27/09): o post na Agenda (foto única ou carrossel, com legenda, data e aprovação) vem primeiro. */}
          {prepararNaAgenda && (
            <Button type="button" size="sm" className="h-8 text-[12px]" disabled={!escolhidas.length} onClick={() => prepararNaAgenda(escolhidas.map((f) => f.id))}>
              <CalendarPlus className="mr-1.5 h-3.5 w-3.5" /> Preparar na Agenda
            </Button>
          )}
          <Button type="button" size="sm" variant={prepararNaAgenda ? "outline" : "default"} className="h-8 text-[12px]" disabled={!escolhidas.length} onClick={() => levar("mesa", escolhidas)}>
            <PenTool className="mr-1.5 h-3.5 w-3.5" /> Usar na Mesa <ArrowUpRight className="ml-1 h-3 w-3" />
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" disabled={!escolhidas.length} onClick={() => levar("ads", escolhidas)}>
            <Megaphone className="mr-1.5 h-3.5 w-3.5" /> Usar na Mesa Ads <ArrowUpRight className="ml-1 h-3 w-3" />
          </Button>
          <div className="flex min-w-0 flex-wrap items-center" data-levar-para-fora="">
            <BotoesDeUso fotos={escolhidas} />
          </div>
        </BarraDeAcoes>
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
