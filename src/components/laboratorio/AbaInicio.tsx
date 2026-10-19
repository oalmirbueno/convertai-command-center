import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, Brush, Globe, Images, LayoutTemplate, Loader2, Megaphone, Sparkles, SquarePen } from "lucide-react";
import { Carregando, botao, campoTexto, espaco, juntar, superficie, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { chaveDosProjetos, listarProjetos, listarTemplates, pedidoInicio, usarTemplate } from "@/lib/laboratorio/api";
import { MODELO_PADRAO_DO_LAB } from "@/lib/laboratorio/nos";
import { CartaoDeProjeto, PreviaDoCanvas } from "./CartaoDeProjeto";
import { SeletorDeCliente, SeletorDeModelo, type ClienteDoLab } from "./Seletores";

/**
 * Início do Laboratório: uma caixa de pedido ("peça um projeto, uma arte,
 * um carrossel, uma logo..."), com modelo e cliente opcional. Os atalhos só
 * preenchem o pedido. Enviar chama `pedido_inicio`, que monta o projeto pelo
 * agente (sem gerar nada) e abre o canvas. Abaixo, os fluxos (oficiais e
 * pessoais, "Usar fluxo") e os projetos recentes.
 */

export const ATALHOS_DA_INICIO = [
  { id: "carrossel", rotulo: "Carrossel", icone: Images, pedido: "Quero criar um carrossel de 5 lâminas sobre " },
  { id: "criativos", rotulo: "Criativos", icone: Sparkles, pedido: "Quero 4 criativos de anúncio para " },
  { id: "logo", rotulo: "Logo", icone: Brush, pedido: "Quero uma logo para a marca " },
  { id: "landing", rotulo: "Landing page", icone: Globe, pedido: "Quero uma landing page para " },
  { id: "post", rotulo: "Post", icone: SquarePen, pedido: "Quero um post com legenda sobre " },
  { id: "anuncio", rotulo: "Anúncio", icone: Megaphone, pedido: "Quero um pacote de anúncio (títulos, texto e público) para " },
] as const;

export default function AbaInicio({
  clienteId,
  onCliente,
  clientes,
  onAbrirProjeto,
}: {
  clienteId: string | null;
  onCliente: (id: string | null) => void;
  clientes: ClienteDoLab[];
  onAbrirProjeto: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [pedido, setPedido] = useState("");
  const [modelo, setModelo] = useState(MODELO_PADRAO_DO_LAB);
  const [enviando, setEnviando] = useState(false);
  const [usando, setUsando] = useState<string | null>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const templates = useQuery({ queryKey: ["laboratorio", "templates"], queryFn: listarTemplates });
  const projetos = useQuery({ queryKey: chaveDosProjetos, queryFn: listarProjetos });

  const enviar = async () => {
    const p = pedido.trim();
    if (!p || enviando) return;
    setEnviando(true);
    try {
      const projeto = await pedidoInicio({ pedido: p, clientId: clienteId, modelo });
      void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
      setPedido("");
      toast.success("Projeto montado", { description: "Confira o fluxo no canvas e rode com o custo à vista." });
      onAbrirProjeto(projeto.id);
    } catch (e) {
      toast.error("Não deu para montar o projeto", { description: textoDoErro(e) });
    } finally {
      setEnviando(false);
    }
  };

  const usar = async (id: string) => {
    setUsando(id);
    try {
      const projeto = await usarTemplate(id, clienteId);
      void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
      onAbrirProjeto(projeto.id);
    } catch (e) {
      toast.error("Não deu para usar o fluxo", { description: textoDoErro(e) });
    } finally {
      setUsando(null);
    }
  };

  const lista = templates.data || [];
  const oficiais = lista.filter((t) => t.oficial);
  const pessoais = lista.filter((t) => !t.oficial);
  const recentes = (projetos.data || []).filter((p) => p.status === "ativo").slice(0, 6);

  const grade = (itens: typeof lista) => (
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {itens.map((t) => (
        <div key={t.id} className={juntar(superficie.painel, "min-w-0 p-3")} data-template={t.id}>
          <PreviaDoCanvas canvas={t.canvas} />
          <div className="mt-2 flex min-w-0 items-center">
            <div className="min-w-0 flex-1">
              <p className={juntar(texto.corpo, "truncate font-medium")}>{t.nome}</p>
              {t.descricao ? <p className={juntar(texto.auxiliar, "truncate")}>{t.descricao}</p> : null}
            </div>
            <button type="button" className={juntar(botao.secundario, "ml-2 h-8 px-2.5")} onClick={() => void usar(t.id)} disabled={!!usando}>
              {usando === t.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Usar fluxo
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className={espaco.pagina} data-aba-inicio="">
      <form
        className="mx-auto w-full min-w-0 max-w-[760px]"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <div className={juntar(superficie.painel, "min-w-0 p-3")}>
          <textarea
            ref={campoRef}
            aria-label="Pedido para o Laboratório"
            className={juntar(campoTexto, "min-h-[96px] resize-none border-0 bg-transparent px-1 text-[15px] focus-visible:ring-0 focus-visible:ring-offset-0")}
            placeholder="Peça um projeto, uma arte, um carrossel, uma logo…"
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
          />
          <div className="mt-2 flex min-w-0 flex-wrap items-center">
            <SeletorDeModelo valor={modelo} onMudar={setModelo} />
            <span className="mx-1" />
            <SeletorDeCliente valor={clienteId} onMudar={onCliente} clientes={clientes} />
            <span className="flex-1" />
            <button type="submit" className={juntar(botao.primario, "h-9 w-9 px-0")} disabled={enviando || !pedido.trim()} aria-label="Enviar o pedido" title="Enviar o pedido (monta o projeto; nada é gerado ainda)">
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowUp className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap justify-center" role="group" aria-label="Atalhos do pedido">
          {ATALHOS_DA_INICIO.map((a) => {
            const I = a.icone;
            return (
              <button
                key={a.id}
                type="button"
                className={juntar(botao.icone, "m-0.5")}
                aria-label={a.rotulo}
                title={a.rotulo}
                data-atalho={a.id}
                onClick={() => {
                  setPedido(a.pedido);
                  if (campoRef.current) campoRef.current.focus();
                }}
              >
                <I className="h-4 w-4" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </form>

      <section className="min-w-0" aria-label="Fluxos">
        <h2 className={juntar(texto.tituloSecao, "mb-3 flex items-center")}>
          <LayoutTemplate className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Fluxos
        </h2>
        {templates.isLoading ? <Carregando forma="grade" rotulo="Lendo os fluxos" /> : templates.isError ? <p className={texto.auxiliar}>{textoDoErro(templates.error)}</p> : oficiais.length ? grade(oficiais) : <p className={texto.auxiliar}>Nenhum fluxo oficial ainda.</p>}
        {pessoais.length > 0 && (
          <>
            <h3 className={juntar(texto.rotulo, "mb-2 mt-5")}>Seus fluxos</h3>
            {grade(pessoais)}
          </>
        )}
      </section>

      {recentes.length > 0 && (
        <section className="min-w-0" aria-label="Projetos recentes">
          <h2 className={juntar(texto.tituloSecao, "mb-3")}>Recentes</h2>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentes.map((p) => (
              <CartaoDeProjeto key={p.id} projeto={p} clientes={clientes} onAbrir={() => onAbrirProjeto(p.id)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
