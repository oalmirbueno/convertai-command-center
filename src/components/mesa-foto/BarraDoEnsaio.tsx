import type { ReactNode } from "react";
import { ArrowRight, Camera, Check, ChevronDown, Layers, Loader2, Plus, Wallet } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMesa } from "@/components/mesa/MesaContexto";
import { estimarLocal, padraoPara, usd } from "@/lib/mesa/api";
import { useMesaFoto, type EtapaDaMesaFoto } from "./Comuns";
import { nomeDaReceita, partesDaGeracao, resumoDoEnsaio, rotuloDoEstadoDoEnsaio, rotuloDoTipo, tomadasParaGerar, useEnsaios, useKits, useReceitas } from "./fotoApi";
import { resumoDoLote, useLotes } from "./lote";
import { objetivoPorValor } from "./linhaDeProducao";

/**
 * Segunda linha da barra da Mesa Foto: o produto (kit) aberto, com a troca
 * ali mesmo (os kits rascunho que o diretor ou a sugestão gravaram também
 * aparecem), o ensaio aberto, o custo, o lote que está gerando (em qualquer
 * etapa) e o próximo passo do caminho principal, sempre em destaque. O kit
 * escolhido vai para o endereço (?kit=), então fica ao recarregar.
 *
 * 28/09 (dono: "menos poluído"): sem ensaio aberto, o "Criando: nenhum" sai
 * (o passo 2 já leva a Criar); sem nada para mostrar, a barra não ocupa linha.
 * No passo 2 as formas de criar entram no começo desta linha (`inicio`), em
 * vez de uma linha própria na etapa. O próximo passo fica em destaque sem ser
 * o primário da tela.
 */
export default function BarraDoEnsaio({ inicio }: { inicio?: ReactNode }) {
  const { clientId, catalogo } = useMesa();
  const { kitId, ensaioId, irPara, escolherKit, proximo, etapa, selecionadas, marcadas: marcadasDaPagina, objetivo, prepararNaAgenda } = useMesaFoto();
  // As marcadas que contam (a página filtra as que não existem e as referências da internet).
  const marcadas = marcadasDaPagina || selecionadas;
  const objetivoAberto = objetivoPorValor(objetivo || null);
  const kits = useKits(clientId);
  const ensaios = useEnsaios(clientId);
  const receitas = useReceitas();
  const lotes = useLotes();
  const lista = kits.data || [];
  const kit = kitId ? lista.find((k) => k.id === kitId) || null : null;
  const ensaio = ensaioId ? (ensaios.data || []).find((e) => e.id === ensaioId) || null : null;
  const resumo = resumoDoEnsaio(ensaio);
  const imagem = padraoPara(catalogo, "imagem");
  const faltam = tomadasParaGerar(ensaio).filter((t) => !t.versoes.length).length;
  const estimativa = ensaio && faltam && imagem ? estimarLocal(partesDaGeracao(imagem.id, "alta", faltam), catalogo) : null;
  const ativos = Object.keys(lotes)
    .map((k) => lotes[k])
    .filter((l) => l.client_id === clientId && l.ativo);
  // Linha de produção (frente FTL, 30/09): nas Fotos com objetivo, o "seguir" já está na faixa do passo
  // (GuiaDaLinha); aqui não repete. O produto só aparece quando está escolhido ou quando o objetivo pede.
  const mostrarProximo = !!proximo && proximo.etapa !== etapa && !(etapa === "acervo" && !!objetivoAberto);
  const mostrarProduto = !!kit || (objetivoAberto ? objetivoAberto.requisito === "produto" : etapa !== "criar");
  const semProduto = !mostrarProduto || (kits.isSuccess && !lista.length && !kit);
  if (!inicio && semProduto && !ensaio && !ativos.length && !mostrarProximo) return null;

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground" aria-label="Produto, lote e custo" data-barra-do-ensaio="">
      {inicio ? <div className="mr-3 min-w-0">{inicio}</div> : null}
      {mostrarProduto && (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="mr-3 inline-flex min-w-0 max-w-full items-center rounded-md py-0.5 hover:text-foreground" aria-label="Trocar o produto (kit)">
            <Layers className="mr-1 h-3.5 w-3.5 shrink-0" />
            <span className="mr-1 hidden sm:inline">Produto:</span>
            <span className={`min-w-0 truncate ${kit ? "font-medium text-foreground" : ""}`}>{kit ? `${kit.nome} · ${rotuloDoTipo(kit.tipo)}` : "nenhum"}</span>
            {kit && kit.status === "rascunho" && <span className="ml-1 shrink-0 rounded-full border border-border px-1.5 text-[11px]">rascunho</span>}
            <ChevronDown className="ml-0.5 h-3 w-3 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh] w-72 max-w-[calc(100vw-24px)] overflow-y-auto">
          {lista.length === 0 && <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Nenhum produto ainda.</p>}
          {lista.map((k) => (
            <DropdownMenuItem key={String(k.id)} onSelect={() => escolherKit(k.id)} className="text-[13px]" data-kit-na-barra={k.id}>
              <span className="mr-2 flex h-3.5 w-3.5 shrink-0 items-center justify-center">{k.id === kitId && <Check className="h-3.5 w-3.5" />}</span>
              <span className="min-w-0 flex-1 truncate">{k.nome}</span>
              <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{k.status === "rascunho" ? "rascunho" : rotuloDoTipo(k.tipo)}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => irPara("acervo")} className="text-[13px]">
            <Plus className="mr-2 h-3.5 w-3.5" /> Identificar um produto pelas fotos
          </DropdownMenuItem>
          {kit && (
            <DropdownMenuItem onSelect={() => irPara("kits")} className="text-[13px]">
              <Layers className="mr-2 h-3.5 w-3.5" /> Detalhes deste produto
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      )}
      {ensaio && (
        <button
          type="button"
          onClick={() => irPara(ensaio.receita_id === "campanha-com-modelo" ? "campanha" : "ensaio", { ensaio: ensaio.id })}
          className="mr-3 inline-flex min-w-0 max-w-full items-center rounded-md py-0.5 hover:text-foreground"
        >
          <Camera className="mr-1 h-3.5 w-3.5 shrink-0" />
          <span className="mr-1 hidden sm:inline">Criando:</span>
          <span className="min-w-0 truncate font-medium text-foreground">
            {`${nomeDaReceita(receitas.data ? receitas.data.receitas : null, ensaio.receita_id)} · ${rotuloDoEstadoDoEnsaio(ensaio.status)}`}
          </span>
        </button>
      )}
      {ensaio && (
        <span className="mr-3 whitespace-nowrap tabular-nums">
          {resumo.aprovadas}/{resumo.total} aprovadas{resumo.paraRevisar ? ` · ${resumo.paraRevisar} esperando aprovação` : ""}
        </span>
      )}
      {ensaio && (
        <span className="mr-3 inline-flex items-center whitespace-nowrap tabular-nums">
          <Wallet className="mr-1 h-3.5 w-3.5" />
          gasto <span className="mx-1 font-medium text-foreground">{usd(resumo.custo)}</span>
          {estimativa !== null && (
            <>
              · falta gerar <span className="ml-1 font-medium text-foreground">~{usd(estimativa)}</span>
            </>
          )}
        </span>
      )}
      {ativos.map((l) => {
        const r = resumoDoLote(l);
        const e = (ensaios.data || []).find((x) => x.id === l.ensaio_id);
        const destino: EtapaDaMesaFoto = e && e.receita_id === "campanha-com-modelo" ? "campanha" : "ensaio";
        return (
          <button
            key={l.ensaio_id}
            type="button"
            onClick={() => irPara(destino, { ensaio: l.ensaio_id })}
            className="mr-3 inline-flex items-center whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary"
            data-lote-na-barra=""
          >
            <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Gerando {Math.min(r.andando + 1, r.total)} de {r.total}
          </button>
        );
      })}
      {mostrarProximo && proximo && (
        <button
          type="button"
          onClick={() => {
            // O post leva as marcadas para a Agenda (a Agenda monta o post com elas); sem isso o
            // post abria vazio. Estúdio e Preparar abrem já na foto marcada (linha de produção, 30/09).
            if (proximo.etapa === "agenda" && marcadas.length && prepararNaAgenda) {
              prepararNaAgenda(marcadas.slice(0, 20));
              return;
            }
            const comFoto = (proximo.etapa === "estudio" || proximo.etapa === "preparar") && marcadas.length ? { ...(proximo.extras || {}), imagem: marcadas[0] } : proximo.extras;
            irPara(proximo.etapa as EtapaDaMesaFoto, comFoto);
          }}
          className="ml-auto inline-flex min-w-0 max-w-full items-center rounded-md border border-primary/50 px-2.5 py-1 text-[12px] font-semibold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-proximo-passo=""
        >
          <span className="truncate">Próximo: {proximo.rotulo}</span>
          <ArrowRight className="ml-1 h-3.5 w-3.5 shrink-0" />
        </button>
      )}
    </div>
  );
}
