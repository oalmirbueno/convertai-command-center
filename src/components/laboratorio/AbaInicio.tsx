import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LayoutTemplate, Loader2 } from "lucide-react";
import { Carregando, botao, espaco, juntar, superficie, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { chaveDosProjetos, criarProjeto, listarProjetos, listarTemplates, pedidoInicio, perguntasDoPedido, usarTemplate, type PerguntaGuiada } from "@/lib/laboratorio/api";
import { MODELO_PADRAO_DO_LAB, ROTULOS_DAS_PERGUNTAS, ehProjetoCompleto, preencherComExemplo } from "@/lib/laboratorio/nos";
import { guardarPedidoPendente } from "@/lib/laboratorio/pedidoPendente";
import { CartaoDeProjeto, PreviaDoCanvas } from "./CartaoDeProjeto";
import CaixaDoPedido, { ATALHOS_DA_INICIO } from "./CaixaDoPedido";
import PerguntasGuiadas from "./PerguntasGuiadas";
import type { ClienteDoLab } from "./Seletores";

/**
 * Início do Laboratório: uma caixa de pedido ("peça um projeto, uma arte,
 * um carrossel, uma logo..."), com modelo e cliente opcional. Os atalhos só
 * preenchem o pedido. Pedido de peça chama `pedido_inicio`, que monta o
 * projeto pelo agente (sem gerar nada) e abre o canvas. Pedido de projeto
 * completo (empresa, low ticket, funil; v2) cria o projeto e abre o canvas
 * na hora: o Canvas Studio manda o `planejar` em modo projeto_completo e o
 * dono vê o quadro sendo construído. Abaixo, os fluxos (oficiais e pessoais,
 * "Usar fluxo") e os projetos recentes.
 *
 * v3: antes de criar o projeto completo, até 4 perguntas guiadas quando falta
 * o essencial (perguntas_do_pedido); os exemplos só preenchem a caixa e as
 * respostas (ou o "pular") seguem com o pedido para o Canvas Studio.
 */

export { ATALHOS_DA_INICIO };

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
  const [atalho, setAtalho] = useState<string | null>(null);
  const [perguntas, setPerguntas] = useState<{ pedido: string; completo: boolean; lista: PerguntaGuiada[] } | null>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const templates = useQuery({ queryKey: ["laboratorio", "templates"], queryFn: listarTemplates });
  const projetos = useQuery({ queryKey: chaveDosProjetos, queryFn: listarProjetos });

  const enviar = async (extra: { respostas?: string; pularPerguntas?: boolean } = {}) => {
    // Com perguntas abertas, a caixa tem as respostas e o pedido é o de antes.
    const p = perguntas ? perguntas.pedido : pedido.trim();
    if (!p || enviando) return;
    const respondendo = !!perguntas;
    const respostas = respondendo && !extra.pularPerguntas ? pedido.trim() : "";
    setEnviando(true);
    try {
      const completo = respondendo ? perguntas!.completo : ehProjetoCompleto(p, atalho, 0);
      if (completo) {
        // Perguntas guiadas antes de criar (só na primeira vez): o que falta do essencial.
        if (!respondendo) {
          const lista = await perguntasDoPedido(p, clienteId).catch(() => [] as PerguntaGuiada[]);
          if (lista.length) {
            setPerguntas({ pedido: p, completo: true, lista });
            setPedido("");
            setAtalho(null);
            return;
          }
        }
        // Projeto completo: abre o canvas já e constrói lá (Canvas Studio), à vista do dono.
        const novo = await criarProjeto({ nome: p.replace(/\s+/g, " ").slice(0, 60), client_id: clienteId, contexto: respostas ? `${p}\n\n${respostas}` : p });
        guardarPedidoPendente(novo.id, { pedido: p, modelo, modo: "projeto_completo", ...(respostas ? { respostas } : {}), ...(extra.pularPerguntas ? { pularPerguntas: true } : {}) });
        void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
        setPedido("");
        setAtalho(null);
        setPerguntas(null);
        onAbrirProjeto(novo.id);
        return;
      }
      const r = await pedidoInicio({ pedido: p, clientId: clienteId, modelo, ...(respostas ? { respostas } : {}), ...(extra.pularPerguntas ? { pularPerguntas: true } : {}) });
      if (!r.projeto) {
        // A função achou que é projeto completo e faltou o essencial: pergunta aqui mesmo.
        setPerguntas({ pedido: p, completo: false, lista: r.perguntas });
        setPedido("");
        setAtalho(null);
        return;
      }
      const projeto = r.projeto;
      setPerguntas(null);
      void queryClient.invalidateQueries({ queryKey: chaveDosProjetos });
      setPedido("");
      setAtalho(null);
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
      <div className="mx-auto w-full min-w-0 max-w-[760px]">
        <CaixaDoPedido
          ref={campoRef}
          valor={pedido}
          onMudar={(v) => {
            setPedido(v);
            if (!v.trim()) setAtalho(null);
          }}
          onEnviar={() => void enviar()}
          enviando={enviando}
          modelo={modelo}
          onModelo={setModelo}
          clienteId={clienteId}
          onCliente={onCliente}
          clientes={clientes}
          atalhos={ATALHOS_DA_INICIO}
          onAtalho={(a) => {
            setPedido(a.pedido);
            setAtalho(a.id);
            if (campoRef.current) campoRef.current.focus();
          }}
          rotulo="Pedido para o Laboratório"
          placeholder={perguntas ? "Responda aqui (ou toque num exemplo) e mande…" : "Peça um projeto completo, uma arte, um carrossel, uma logo…"}
          tituloDoEnviar="Enviar o pedido (monta o projeto no canvas; nada é gerado ainda)"
        />
        {perguntas ? (
          <PerguntasGuiadas
            perguntas={perguntas.lista}
            ocupado={enviando}
            onExemplo={(q, ex) => {
              setPedido((v) => preencherComExemplo(v, ROTULOS_DAS_PERGUNTAS[q.id] || q.pergunta.replace(/[?].*$/, ""), ex));
              if (campoRef.current) campoRef.current.focus();
            }}
            onPular={() => void enviar({ pularPerguntas: true })}
            onFechar={() => setPerguntas(null)}
          />
        ) : null}
      </div>

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
