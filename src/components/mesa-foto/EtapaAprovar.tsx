import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ClipboardCheck, Loader2, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Ampliar } from "@/components/mesa/Ampliar";
import { AvisoDeErro, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { Carregando } from "@/components/sistema/Estados";
import { juntar, superficie } from "@/components/sistema/estilos";
import { AprovarFoto } from "./AcoesDeUso";
import { Cartao, MiniaturaDaFoto, Moldura, useMesaFoto, Vazio } from "./Comuns";
import { acrescentarFotos, classeDaFoto, decidirFoto, decidirVersao, fotosParaRevisar, guardarEnsaio, invalidarFotos, proporcaoDoFormato, useEnsaios, useFotos, type FotoDoAcervo, type FotoParaRevisar } from "./fotoApi";
import DepoisDeAprovar from "./DepoisDeAprovar";
import { DecisaoRapida, MenuDeUso, precisaAprovar } from "./UsoDaFoto";

/**
 * Passo 4 da linha de produção, "Aprovar" (frente FTL, 30/09; dono: "a
 * linha de produção das fotos está muito confusa e difícil, facilite").
 *
 * Conferir e aprovar num lugar só. Antes a revisão ficava espalhada: no
 * resultado de Variações e Campanha, num bloco dentro de Usar e na tela de
 * comparar. Aqui estão as duas filas:
 * - Dos lotes (Fotos do produto e Foto com modelo): a última versão de cada
 *   foto ainda sem decisão, com Aprovar, Rejeitar (com motivo) e o menu Usar.
 *   "Comparar com as fontes" abre a revisão lado a lado (?etapa=revisar).
 * - Outras fotos geradas (Estúdio, ângulo, clone, canvas): as do acervo que
 *   ainda não têm a aprovação da equipe. Aprovada, a foto fica na lista com o
 *   selo até sair da tela, para a pessoa ver o que já decidiu.
 * Embaixo, o passo seguinte: Usar as aprovadas.
 *
 * Aprovar é da equipe; a aprovação do cliente é outra (menu Usar ou Post na
 * Agenda). A conferência automática, quando existe, é aviso e nunca decide.
 */

/** Chave de uma versão do lote na seleção. */
export const chaveDaPendente = (p: Pick<FotoParaRevisar, "ensaio" | "tomada" | "versao">) => `lote:${p.ensaio.id}:${p.tomada.id}:${p.versao.versao}`;

interface Selecao {
  marcadas: string[];
  alternar: (chave: string) => void;
  onAprovada: (imagem: FotoDoAcervo | null) => void;
}

function CaixaDeMarcar({ chave, nome, selecao }: { chave: string; nome: string; selecao: Selecao }) {
  return (
    <label className="absolute right-1.5 top-1.5 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-md border border-border bg-card shadow-sm">
      <input type="checkbox" checked={selecao.marcadas.indexOf(chave) >= 0} onChange={() => selecao.alternar(chave)} className="h-3.5 w-3.5 accent-[hsl(var(--primary))]" aria-label={`Marcar ${nome}`} />
    </label>
  );
}

function DoLote({ selecao }: { selecao: Selecao }) {
  const { clientId } = useMesa();
  const { ensaioId, irPara } = useMesaFoto();
  const ensaios = useEnsaios(clientId);
  const pendentes = useMemo(() => fotosParaRevisar(ensaios.data || [], ensaioId), [ensaios.data, ensaioId]);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  if (ensaios.isLoading) return <Carregando forma="grade" linhas={4} rotulo="Lendo os lotes" />;
  if (ensaios.isError) return <AvisoDeErro erro={ensaios.error} />;
  if (!pendentes.length) return null;
  return (
    <Cartao
      titulo={`Dos lotes · ${pendentes.length}`}
      recolher={`mesa-foto:aprovar:lote:${clientId}`}
      resumo="fotos do produto e com modelo esperando decisão"
      dica="Fotos geradas em Fotos do produto e Foto com modelo. Aprovar põe a foto no acervo, pronta para usar; rejeitar pede o motivo, que ensina o diretor."
      acao={
        <Button type="button" size="sm" variant="ghost" className="h-8 text-[12px]" onClick={() => irPara("revisar", { ensaio: pendentes[0].ensaio.id })}>
          <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Comparar com as fontes
        </Button>
      }
    >
      <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-para-revisar="" data-aprovar-do-lote="">
        {pendentes.map((p, i) => (
          <li key={`${p.ensaio.id}-${p.tomada.id}-${p.versao.versao}`} className={juntar(superficie.painel, "relative min-w-0 p-1.5")} data-pendente={p.tomada.id}>
            <CaixaDeMarcar chave={chaveDaPendente(p)} nome={p.tomada.nome} selecao={selecao} />
            <button type="button" className="block w-full cursor-zoom-in" onClick={() => setAmpliada(i)} aria-label={`Ver grande: ${p.tomada.nome}`}>
              <Moldura proporcao={proporcaoDoFormato(p.tomada.formato)} className="border border-border">
                <ImagemDaMesa caminho={p.versao.storage_path || ""} alt={p.tomada.nome} className="h-full w-full !object-contain" />
                <span className="pointer-events-none absolute left-1 top-1 rounded-full border border-primary/30 bg-card px-1.5 py-px text-[11px] font-semibold text-primary" data-selo="gerada">
                  gerada
                </span>
              </Moldura>
            </button>
            <p className="mt-1 truncate px-0.5 text-[12px] font-medium" title={p.tomada.nome}>
              {p.tomada.nome} <span className="font-normal text-muted-foreground">v{p.versao.versao}</span>
            </p>
            <div className="mt-1 flex min-w-0 flex-wrap items-center">
              <DecisaoRapida ensaio={p.ensaio} tomada={p.tomada} versao={p.versao} compacta onDecidiu={(d, img) => d === "aprovar" && selecao.onAprovada(img)} />
              <MenuDeUso pendente={p} variante="outline" className="mb-1" />
            </div>
          </li>
        ))}
      </ul>
      <Ampliar
        imagens={pendentes.map((p) => ({ caminho: p.versao.storage_path || "", titulo: `${p.tomada.nome}, v${p.versao.versao} (gerada)`, legenda: "Imagem gerada por IA", proporcao: proporcaoDoFormato(p.tomada.formato) }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </Cartao>
  );
}

/** As geradas do acervo que ainda esperam a equipe (a aprovada fica à vista até sair da tela). */
export function geradasParaAprovar(fotos: FotoDoAcervo[], vistas: string[]): FotoDoAcervo[] {
  return fotos.filter((f) => !f.referencia_web && classeDaFoto(f) === "gerada" && (precisaAprovar(f) || vistas.indexOf(f.id) >= 0));
}

function DoAcervo({ selecao }: { selecao: Selecao }) {
  const { clientId } = useMesa();
  const fotos = useFotos(clientId);
  const todas = useMemo(() => fotos.data || [], [fotos.data]);
  const [vistas, setVistas] = useState<string[]>([]);
  // Guarda as que apareceram como pendentes: aprovar não tira a foto da lista na hora.
  useEffect(() => {
    const novas = todas.filter((f) => !f.referencia_web && precisaAprovar(f) && vistas.indexOf(f.id) < 0).map((f) => f.id);
    if (novas.length) setVistas((v) => v.concat(novas));
  }, [todas, vistas]);
  const lista = useMemo(() => geradasParaAprovar(todas, vistas), [todas, vistas]);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  if (!lista.length) return null;
  const faltam = lista.filter((f) => precisaAprovar(f)).length;
  return (
    <Cartao
      titulo={`Outras fotos geradas · ${faltam}`}
      recolher={`mesa-foto:aprovar:acervo:${clientId}`}
      resumo="Estúdio, ângulo, clone e quadro livre"
      dica="Fotos geradas fora dos lotes (Estúdio, novo ângulo, clone, quadro livre). Foto gerada só vai para as mesas e para o cliente depois da aprovação da equipe."
    >
      <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-aprovar-do-acervo="">
        {lista.map((f, i) => (
          <li key={f.id} className={juntar(superficie.painel, "relative min-w-0 p-1.5", f.aprovada && "border-success/50")} data-gerada-para-aprovar={f.id}>
            {!f.aprovada && <CaixaDeMarcar chave={f.id} nome={f.nome} selecao={selecao} />}
            <div className="relative min-w-0">
              <MiniaturaDaFoto foto={f} />
              <button
                type="button"
                onClick={() => setAmpliada(i)}
                aria-label={`Ver grande ${f.nome}`}
                className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm hover:text-foreground"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="mt-1 truncate px-0.5 text-[12px] font-medium" title={f.nome}>
              {f.nome}
            </p>
            <div className="mt-1 flex min-w-0 flex-wrap items-center">
              <AprovarFoto foto={f} onMudou={(nova) => nova.aprovada && selecao.onAprovada(nova)} />
              <MenuDeUso foto={f} variante="outline" className="mb-1" />
            </div>
          </li>
        ))}
      </ul>
      <Ampliar
        imagens={lista.map((f) => ({ caminho: f.storage_path, bucket: f.storage_bucket || "mesa", titulo: f.nome, legenda: "Imagem gerada por IA", proporcao: f.largura && f.altura ? f.largura / f.altura : undefined }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </Cartao>
  );
}

export default function EtapaAprovar() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const { ensaioId, irPara } = useMesaFoto();
  const fotos = useFotos(clientId);
  const ensaios = useEnsaios(clientId);
  const todas = fotos.data || [];
  const pendentesDoLote = useMemo(() => fotosParaRevisar(ensaios.data || [], ensaioId), [ensaios.data, ensaioId]);
  const doLote = pendentesDoLote.length;
  const doAcervo = todas.filter((f) => !f.referencia_web && precisaAprovar(f)).length;
  const aprovadas = todas.filter((f) => f.aprovada && !f.referencia_web).length;
  const carregando = fotos.isLoading || ensaios.isLoading;
  const nada = !carregando && fotos.isSuccess && ensaios.isSuccess && doLote === 0 && doAcervo === 0;
  // 02/10 (dono: "Aprovar não tem lógica"): marcar, aprovar as marcadas e seguir com as aprovadas agora.
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [recemAprovadas, setRecemAprovadas] = useState<string[]>([]);
  const [aprovando, setAprovando] = useState(false);
  const selecao: Selecao = {
    marcadas,
    alternar: (k) => setMarcadas((m) => (m.indexOf(k) >= 0 ? m.filter((x) => x !== k) : m.concat([k]))),
    onAprovada: (img) => {
      if (img) setRecemAprovadas((l) => (l.indexOf(img.id) >= 0 ? l : l.concat([img.id])));
    },
  };
  const chavesPendentes = pendentesDoLote.map(chaveDaPendente).concat(todas.filter((f) => !f.referencia_web && precisaAprovar(f)).map((f) => f.id));
  const marcadasValidas = marcadas.filter((k) => chavesPendentes.indexOf(k) >= 0);
  const fotosRecem = todas.filter((f) => recemAprovadas.indexOf(f.id) >= 0 && f.aprovada);

  const aprovarMarcadas = async () => {
    if (aprovando || !marcadasValidas.length) return;
    setAprovando(true);
    const novas: string[] = [];
    let falhas = 0;
    for (const k of marcadasValidas) {
      try {
        if (k.indexOf("lote:") === 0) {
          const p = pendentesDoLote.find((x) => chaveDaPendente(x) === k);
          if (!p) continue;
          const r = await decidirVersao({ ensaioId: p.ensaio.id, tomadaId: p.tomada.id, versao: p.versao.versao, decisao: "aprovar" });
          if (r.ensaio) guardarEnsaio(queryClient, clientId, r.ensaio);
          if (r.imagem) {
            acrescentarFotos(queryClient, clientId, [r.imagem]);
            novas.push(r.imagem.id);
          }
        } else {
          const nova = await decidirFoto(clientId, k, "aprovar");
          if (nova) acrescentarFotos(queryClient, clientId, [nova]);
          novas.push(k);
        }
      } catch (e) {
        falhas++;
        if (falhas === 1) avisarErro(e, "Uma foto não foi aprovada");
      }
    }
    invalidarFotos(queryClient, clientId);
    setMarcadas([]);
    setRecemAprovadas((l) => l.concat(novas.filter((id) => l.indexOf(id) < 0)));
    setAprovando(false);
    if (novas.length) toast.success(`${novas.length} ${novas.length === 1 ? "foto aprovada" : "fotos aprovadas"}`, { description: "Escolha logo acima para onde elas vão." });
  };

  return (
    <div className="min-w-0 space-y-5" data-etapa-aprovar="">
      {fotosRecem.length > 0 && <DepoisDeAprovar fotos={fotosRecem} onFeito={() => setRecemAprovadas([])} />}
      {chavesPendentes.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center" data-barra-de-aprovar="">
          <button
            type="button"
            className="mb-1 mr-3 text-[12px] font-medium text-primary hover:underline"
            onClick={() => setMarcadas(marcadasValidas.length === chavesPendentes.length ? [] : chavesPendentes.slice())}
          >
            {marcadasValidas.length === chavesPendentes.length ? "Desmarcar todas" : `Marcar todas (${chavesPendentes.length})`}
          </button>
          <Button type="button" size="sm" className="mb-1 h-8 text-[12px]" disabled={!marcadasValidas.length || aprovando} onClick={() => void aprovarMarcadas()} data-aprovar-marcadas={marcadasValidas.length}>
            {aprovando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
            Aprovar {marcadasValidas.length ? `${marcadasValidas.length} ${marcadasValidas.length === 1 ? "marcada" : "marcadas"}` : "as marcadas"}
          </Button>
        </div>
      )}
      <p className="text-[12px] text-muted-foreground" data-resumo-da-aprovacao="">
        {carregando
          ? "Lendo o que foi gerado."
          : doLote + doAcervo > 0
            ? `${doLote + doAcervo} ${doLote + doAcervo === 1 ? "foto espera" : "fotos esperam"} a sua decisão. Confira cada uma e aprove ou refaça.`
            : "Nada esperando a sua decisão."}
      </p>
      {fotos.isError && <AvisoDeErro erro={fotos.error} />}

      <DoLote selecao={selecao} />
      <DoAcervo selecao={selecao} />

      {nada && (
        <Vazio
          titulo="Tudo decidido por aqui"
          acao={
            <>
              <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-8 text-[12px]" onClick={() => irPara("criar")}>
                Gerar mais fotos
              </Button>
              {aprovadas > 0 && (
                <Button type="button" size="sm" className="mb-1 h-8 text-[12px]" onClick={() => irPara("usar")}>
                  Usar as aprovadas
                </Button>
              )}
            </>
          }
        >
          As fotos geradas aparecem aqui para a equipe aprovar antes de usar.
        </Vazio>
      )}

      {!nada && aprovadas > 0 && (
        <div className="flex min-w-0 flex-wrap items-center justify-end border-t border-border pt-3" data-seguir-para-usar="">
          <span className="mb-1 mr-3 text-[12px] tabular-nums text-muted-foreground">
            {aprovadas} {aprovadas === 1 ? "aprovada pronta" : "aprovadas prontas"} para usar
          </span>
          <Button type="button" size="sm" className="mb-1 h-8 text-[12px]" onClick={() => irPara("usar")}>
            Seguir: Usar <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
