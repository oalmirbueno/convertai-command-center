import { Aperture, ArrowRight, BookOpen, CalendarDays, CalendarPlus, Images, Library, Megaphone, Shapes, UserRound, UsersRound, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMesa } from "@/components/mesa/MesaContexto";
import { MiniaturaDaFoto, useMesaFoto, type EtapaDaMesaFoto } from "./Comuns";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { foco, juntar } from "@/components/sistema/estilos";
import { periodoDaCampanha, rotuloDoTipo, useCampanhasDaMesa, useEnsaios, useFotos, useKits } from "./fotoApi";

/**
 * Passo 2, Criar: "o que você quer fazer?" (pedido do dono, 27/09: "ainda
 * está confuso, não está tão facilitado pra criar"). Quatro caminhos diretos,
 * na ordem do que mais se faz:
 * 1. Editar uma foto (Estúdio de fotos): a foto grande e as ferramentas ao
 *    lado. Não precisa de produto.
 * 2. Post na Agenda: foto única ou carrossel com legenda, data e aprovação do
 *    cliente. Não precisa de produto.
 * 3. Variações do produto e 4. Campanha com modelo: precisam do produto (kit).
 * Embaixo, numa linha discreta, o ajuste fino (Preparar) e as ferramentas de
 * apoio (Book, Clones, Modelos, Canvas, Biblioteca), a um clique.
 *
 * O produto aberto fica numa linha com a troca ao lado; a campanha do mês
 * numa linha com a explicação no "?"; os pedidos ao diretor vão para a lateral.
 */

const FORMAS: { etapa: EtapaDaMesaFoto; titulo: string; texto: string; icone: typeof Wand2; precisaDeProduto: boolean }[] = [
  {
    etapa: "estudio",
    titulo: "Editar uma foto",
    texto: "Estúdio de fotos: luz, cor, fundo, cenário, ângulo, ampliar e o recorte do post.",
    icone: Wand2,
    precisaDeProduto: false,
  },
  {
    etapa: "agenda",
    titulo: "Post na Agenda",
    texto: "Foto única ou carrossel com legenda, data e aprovação do cliente.",
    icone: CalendarPlus,
    precisaDeProduto: false,
  },
  {
    etapa: "ensaio",
    titulo: "Variações do produto",
    texto: "4 a 16 fotos: fundo de cor, lifestyle, na mão, flat lay, macro.",
    icone: Images,
    precisaDeProduto: true,
  },
  {
    etapa: "campanha",
    titulo: "Campanha com modelo",
    texto: "Pessoa sintética usando o produto, na pegada da marca.",
    icone: Megaphone,
    precisaDeProduto: true,
  },
];

const APOIOS: { etapa: EtapaDaMesaFoto; rotulo: string; icone: typeof Wand2 }[] = [
  { etapa: "book", rotulo: "Book", icone: BookOpen },
  { etapa: "clones", rotulo: "Clones", icone: UsersRound },
  { etapa: "modelos", rotulo: "Modelos", icone: UserRound },
  { etapa: "canvas", rotulo: "Canvas", icone: Shapes },
  { etapa: "biblioteca", rotulo: "Biblioteca", icone: Library },
];

export default function EtapaCriar() {
  const { clientId } = useMesa();
  const { kitId, irPara, pedirAoDiretor, selecionadas } = useMesaFoto();
  const kits = useKits(clientId);
  const fotos = useFotos(clientId);
  const ensaios = useEnsaios(clientId);
  const lista = kits.data || [];
  const kit = kitId ? lista.find((k) => k.id === kitId) || null : null;
  const capa = kit ? (fotos.data || []).find((f) => f.id === (kit.frente_imagem_id || (kit.refs[0] && kit.refs[0].imagem_id))) || null : null;
  const doKit = kit ? (ensaios.data || []).filter((e) => e.kit_id === kit.id).length : 0;
  const campanhas = useCampanhasDaMesa(clientId);
  const doMes = campanhas.data && campanhas.data.campanhaDoMesId ? campanhas.data.campanhas.find((c) => c.id === (campanhas.data && campanhas.data.campanhaDoMesId)) || null : null;
  const semProduto = kits.isSuccess && !lista.length;
  // Foto marcada em Fotos: o Estúdio já abre nela.
  const marcada = selecionadas.length ? selecionadas[0] : null;

  const abrir = (etapa: EtapaDaMesaFoto) => {
    if (etapa === "estudio" && marcada) irPara("estudio", { imagem: marcada });
    else irPara(etapa);
  };

  return (
    <div className="min-w-0 space-y-5" data-etapa-criar="">
      <div className="flex min-w-0 items-center" data-produto-aberto="">
        <span className="mr-2.5 w-10 shrink-0">{capa ? <MiniaturaDaFoto foto={capa} selo={false} /> : <span className="block h-10 w-10 rounded-md bg-muted" />}</span>
        <div className="mr-2 min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{kit ? kit.nome : semProduto ? "Sem produto identificado" : "Nenhum produto escolhido"}</p>
          <p className="truncate text-[11.5px] text-muted-foreground">
            {kit
              ? `${rotuloDoTipo(kit.tipo)}${kit.variante ? ` · ${kit.variante}` : ""} · ${doKit} ${doKit === 1 ? "lote criado" : "lotes criados"}`
              : "Variações e Campanha partem do produto; o Estúdio e o Post na Agenda funcionam com qualquer foto."}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 text-[12px]" onClick={() => irPara("acervo")}>
          {kit ? "Trocar" : semProduto ? "Identificar" : "Escolher"}
        </Button>
      </div>

      {doMes && (
        <div className="flex min-w-0 items-center text-[12px] text-muted-foreground" data-campanha-do-mes={doMes.id}>
          <CalendarDays className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="mr-1 shrink-0">Campanha do mês:</span>
          <span className="mr-1 min-w-0 truncate font-medium text-foreground">{doMes.nome}</span>
          <span className="shrink-0 tabular-nums">({periodoDaCampanha(doMes)})</span>
          <AjudaRecolhida className="ml-1" rotulo="Sobre a campanha do mês">
            Variações e Campanha já partem da campanha do mês na Mesa; dá para trocar lá dentro.
          </AjudaRecolhida>
        </div>
      )}

      <div className="min-w-0">
        <h2 className="mb-2 text-[13px] font-semibold">O que você quer fazer?</h2>
        <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {FORMAS.map((f) => {
            const Icone = f.icone;
            const travada = f.precisaDeProduto && !kit;
            return (
              <li key={f.etapa} className="min-w-0">
                <button
                  type="button"
                  onClick={() => abrir(f.etapa)}
                  disabled={travada}
                  className={juntar("flex h-full w-full min-w-0 flex-col rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 disabled:opacity-60", foco)}
                  data-forma-de-criar={f.etapa}
                >
                  <Icone className="h-5 w-5 text-primary" />
                  <span className="mt-2 block text-[14px] font-semibold">{f.titulo}</span>
                  <span className="mt-1 block text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{f.texto}</span>
                  <span className="mt-3 inline-flex items-center text-[12px] font-medium text-primary">
                    {travada ? "Precisa do produto" : f.etapa === "estudio" && marcada ? "Abrir a foto marcada" : "Abrir"} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {pedirAoDiretor && (
        <div className="flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground" data-pedir-ao-diretor="">
          <Aperture className="mr-1.5 h-3.5 w-3.5 text-primary" />
          <span className="mr-2">Ou peça ao diretor, que faz e deixa o caminho:</span>
          {kit && (
            <button type="button" className="mr-3 font-medium text-primary hover:underline" onClick={() => pedirAoDiretor("Monte um plano de 8 variações para este produto, com tipos bem diferentes.")}>
              8 variações
            </button>
          )}
          {kit && (
            <button type="button" className="mr-3 font-medium text-primary hover:underline" onClick={() => pedirAoDiretor("Monte uma campanha com modelo sintético usando este produto, com a pegada da marca.")}>
              Campanha com modelo
            </button>
          )}
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => pedirAoDiretor("Monte um carrossel de fotos para a Agenda com as melhores fotos aprovadas do cliente, na ordem certa, e me leve para o post.")}>
            Carrossel na Agenda
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-wrap items-center border-t border-border pt-3 text-[12px] text-muted-foreground" data-apoios-do-criar="">
        <span className="mb-1 mr-2">Mais ferramentas:</span>
        <button type="button" className="mb-1 mr-3 font-medium text-primary hover:underline" onClick={() => (marcada ? irPara("preparar", { imagem: marcada }) : irPara("preparar"))}>
          Ajuste fino (áreas protegidas)
        </button>
        {APOIOS.map((a) => {
          const Icone = a.icone;
          return (
            <button key={a.etapa} type="button" onClick={() => irPara(a.etapa)} className={juntar("mb-1 mr-1.5 inline-flex h-7 items-center rounded-full border border-border bg-background px-2.5 text-[11.5px] text-foreground hover:border-primary/50", foco)}>
              <Icone className="mr-1 h-3.5 w-3.5 text-primary" /> {a.rotulo}
            </button>
          );
        })}
      </div>
    </div>
  );
}
