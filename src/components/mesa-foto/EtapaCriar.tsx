import { useMemo } from "react";
import { Aperture, ArrowRight, BookOpen, CalendarDays, Check, ClipboardCheck, Library, Shapes, UserRound, UsersRound, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Cartao, MiniaturaDaFoto, useMesaFoto, type EtapaDaMesaFoto } from "./Comuns";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { foco, juntar, superficie } from "@/components/sistema/estilos";
import { fotosParaRevisar, periodoDaCampanha, rotuloDoTipo, useCampanhasDaMesa, useEnsaios, useFotos, useKits } from "./fotoApi";
import { ICONES_DOS_OBJETIVOS, useSeguirNaLinha } from "./GuiaDaLinha";
import { OBJETIVOS } from "./linhaDeProducao";
import { precisaAprovar } from "./UsoDaFoto";

/**
 * Passo 1 da linha de produção, "O que fazer" (frente FTL, 30/09; dono: "a
 * linha de produção das fotos está muito confusa e difícil, facilite").
 *
 * Antes a pessoa subia as fotos e só depois descobria o que dava para fazer
 * com elas. Agora começa pelo que quer produzir, em palavras simples:
 * 1. Melhorar uma foto (Estúdio), 2. Fotos do produto (Variações),
 * 3. Foto com modelo (Campanha), 4. Tirar fundo e ajustes (Preparar) e
 * 5. Post com fotos (Agenda). Cada cartão diz o que precisa; o toque guarda a
 * escolha e leva para o passo 2 (Fotos), que já sabe o que pedir.
 *
 * Em cima, uma linha com o que está esperando aprovação (retomar de onde
 * parou). Embaixo, recolhidas, as formas avançadas (Book, Clones, Modelos,
 * Canvas e Biblioteca) e os pedidos prontos ao diretor.
 */

const AVANCADAS: { etapa: EtapaDaMesaFoto; rotulo: string; texto: string; icone: LucideIcon }[] = [
  { etapa: "book", rotulo: "Book", texto: "Book do produto ou da pessoa", icone: BookOpen },
  { etapa: "clones", rotulo: "Pessoa real (Clones)", texto: "Mesmo rosto em outras cenas, com autorização", icone: UsersRound },
  { etapa: "modelos", rotulo: "Pessoas da IA (Modelos)", texto: "Modelos sintéticos para as campanhas", icone: UserRound },
  { etapa: "canvas", rotulo: "Quadro livre (Canvas)", texto: "Montar o fluxo de geração à mão", icone: Shapes },
  { etapa: "biblioteca", rotulo: "Ideias e referências (Biblioteca)", texto: "Prompts prontos e fotos de referência", icone: Library },
];

export default function EtapaCriar() {
  const { clientId } = useMesa();
  const { kitId, irPara, pedirAoDiretor, escolherObjetivo, ensaioId } = useMesaFoto();
  const { objetivo, prontidao, seguir } = useSeguirNaLinha();
  const kits = useKits(clientId);
  const fotos = useFotos(clientId);
  const ensaios = useEnsaios(clientId);
  const lista = kits.data || [];
  const kit = kitId ? lista.find((k) => k.id === kitId) || null : null;
  const capa = kit ? (fotos.data || []).find((f) => f.id === (kit.frente_imagem_id || (kit.refs[0] && kit.refs[0].imagem_id))) || null : null;
  const doKit = kit ? (ensaios.data || []).filter((e) => e.kit_id === kit.id).length : 0;
  const campanhas = useCampanhasDaMesa(clientId);
  const doMes = campanhas.data && campanhas.data.campanhaDoMesId ? campanhas.data.campanhas.find((c) => c.id === (campanhas.data && campanhas.data.campanhaDoMesId)) || null : null;
  // Retomar: o que já foi gerado e espera a decisão da equipe (lotes e fotos do acervo).
  const esperando = useMemo(() => {
    const doLote = fotosParaRevisar(ensaios.data || [], ensaioId).length;
    const doAcervo = (fotos.data || []).filter((f) => !f.referencia_web && precisaAprovar(f)).length;
    return doLote + doAcervo;
  }, [ensaios.data, fotos.data, ensaioId]);

  const escolher = (valor: (typeof OBJETIVOS)[number]["valor"]) => {
    if (escolherObjetivo) escolherObjetivo(valor, true);
    else irPara("acervo");
  };

  return (
    <div className="min-w-0 space-y-5" data-etapa-criar="">
      {esperando > 0 && (
        <div className="flex min-w-0 flex-wrap items-center text-[13px]" data-esperando-aprovacao={esperando}>
          <ClipboardCheck className="mr-1.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="mr-2 min-w-0">
            {esperando} {esperando === 1 ? "foto gerada espera" : "fotos geradas esperam"} a sua aprovação.
          </span>
          <button type="button" className={juntar("rounded font-medium text-primary hover:underline", foco)} onClick={() => irPara("aprovar")}>
            Aprovar agora
          </button>
        </div>
      )}

      <Cartao
        titulo="O que você quer produzir?"
        recolher={false}
        className="border-t-0 pt-0"
        dica="Escolha e a mesa leva você pelos passos: fotos, gerar, aprovar e usar. Cada cartão diz o que precisa. A escolha fica guardada para este cliente."
      >
        <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 desk:grid-cols-5" data-objetivos="">
          {OBJETIVOS.map((o) => {
            const Icone = ICONES_DOS_OBJETIVOS[o.valor];
            const escolhido = !!objetivo && objetivo.valor === o.valor;
            return (
              <li key={o.valor} className="min-w-0">
                <button
                  type="button"
                  onClick={() => escolher(o.valor)}
                  aria-pressed={escolhido}
                  className={juntar(
                    superficie.painel,
                    "flex h-full w-full min-w-0 flex-col p-4 text-left transition-colors hover:border-primary/50",
                    escolhido && "border-primary ring-1 ring-primary",
                    foco,
                  )}
                  data-objetivo={o.valor}
                  data-forma-de-criar={o.etapa}
                >
                  <span className="flex min-w-0 items-center">
                    <Icone className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    {escolhido && (
                      <span className="ml-auto inline-flex items-center rounded-full bg-primary/10 px-2 py-px text-[11px] font-semibold text-primary">
                        <Check className="mr-0.5 h-3 w-3" aria-hidden="true" /> escolhido
                      </span>
                    )}
                  </span>
                  <span className="mt-2 block text-[14px] font-semibold">{o.titulo}</span>
                  <span className="mt-1 block text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{o.texto}</span>
                  <span className="mt-auto block pt-3 text-[11px] text-muted-foreground">
                    Precisa: <span className="font-medium text-foreground">{o.precisa}</span>
                  </span>
                  <span className="mt-1.5 inline-flex items-center text-[12px] font-medium text-primary">
                    {o.requisito === "fotos" ? "Escolher as fotos" : o.requisito === "produto" ? "Escolher o produto" : "Escolher a foto"} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {objetivo && prontidao.pronto && (
          // Já tem o que precisa (foto marcada ou produto escolhido): pula direto para gerar.
          <div className="mt-3 flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground" data-atalho-da-linha="">
            <span className="mr-2">Já tem o que precisa para {objetivo.titulo.toLowerCase()}.</span>
            <Button type="button" size="sm" className="h-8 text-[12px]" onClick={seguir}>
              {prontidao.seguir} <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </Cartao>

      {kit && (
        <div className="flex min-w-0 items-center" data-produto-aberto="">
          <span className="mr-2.5 w-10 shrink-0">{capa ? <MiniaturaDaFoto foto={capa} selo={false} /> : <span className="block h-10 w-10 rounded-md bg-muted" />}</span>
          <div className="mr-2 min-w-0 flex-1">
            <div className="flex min-w-0 items-center">
              <p className="min-w-0 truncate text-[13px] font-semibold">
                <span className="font-normal text-muted-foreground">Produto: </span>
                {kit.nome}
              </p>
              <AjudaRecolhida className="ml-1.5" rotulo="Precisa de produto?">
                Fotos do produto e Foto com modelo partem do produto; melhorar uma foto, tirar fundo e o post funcionam com qualquer foto.
              </AjudaRecolhida>
            </div>
            <p className="truncate text-[12px] text-muted-foreground">
              {`${rotuloDoTipo(kit.tipo)}${kit.variante ? ` · ${kit.variante}` : ""} · ${doKit} ${doKit === 1 ? "lote criado" : "lotes criados"}`}
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 text-[12px]" onClick={() => irPara("acervo")}>
            Trocar
          </Button>
        </div>
      )}

      {doMes && (
        <div className="flex min-w-0 items-center text-[12px] text-muted-foreground" data-campanha-do-mes={doMes.id}>
          <CalendarDays className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="mr-1 shrink-0">Campanha do mês:</span>
          <span className="mr-1 min-w-0 truncate font-medium text-foreground">{doMes.nome}</span>
          <span className="shrink-0 tabular-nums">({periodoDaCampanha(doMes)})</span>
          <AjudaRecolhida className="ml-1" rotulo="Sobre a campanha do mês">
            Fotos do produto e Foto com modelo já partem da campanha do mês na Mesa; dá para trocar lá dentro.
          </AjudaRecolhida>
        </div>
      )}

      <Cartao
        titulo="Mais formas de criar"
        recolher={`mesa-foto:criar:avancadas:${clientId}`}
        recolhidoDeInicio
        resumo="Book, pessoa real, pessoas da IA, quadro livre e ideias"
        dica="Ferramentas para quem já conhece a mesa. Também ficam no botão Mais, no alto."
      >
        <ul className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3" data-apoios-do-criar="">
          {AVANCADAS.map((a) => {
            const Icone = a.icone;
            return (
              <li key={a.etapa} className="min-w-0">
                <button
                  type="button"
                  onClick={() => irPara(a.etapa)}
                  className={juntar("flex w-full min-w-0 items-center rounded-md px-2 py-2 text-left hover:bg-muted", foco)}
                  data-avancada={a.etapa}
                >
                  <Icone className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{a.rotulo}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{a.texto}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Cartao>

      {pedirAoDiretor && (
        <div className="flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground" data-pedir-ao-diretor="">
          <Aperture className="mr-1.5 h-3.5 w-3.5 text-primary" />
          <span className="mr-2">Ou peça ao diretor, que faz e deixa o caminho:</span>
          {kit && (
            <button type="button" className="mr-3 font-medium text-primary hover:underline" onClick={() => pedirAoDiretor("Monte um plano de 8 variações para este produto, com tipos bem diferentes.")}>
              8 fotos do produto
            </button>
          )}
          {kit && (
            <button type="button" className="mr-3 font-medium text-primary hover:underline" onClick={() => pedirAoDiretor("Monte uma campanha com modelo sintético usando este produto, com a pegada da marca.")}>
              Foto com modelo
            </button>
          )}
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => pedirAoDiretor("Monte um carrossel de fotos para a Agenda com as melhores fotos aprovadas do cliente, na ordem certa, e me leve para o post.")}>
            Carrossel na Agenda
          </button>
        </div>
      )}
    </div>
  );
}
