import { useState } from "react";
import { toast } from "sonner";
import { Download, FolderOpen, Loader2, Sparkles, Star } from "lucide-react";
import { botao, campo, campoTexto, espaco, juntar, texto } from "@/components/sistema";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { gerarLogo, type PedidoDeLogo, type ResultadoDaLogo } from "@/lib/laboratorio/api";
import JanelaDeCusto from "./JanelaDeCusto";
import { useImagens } from "./ResultadoDoNo";
import { SeletorDeCliente, type ClienteDoLab } from "./Seletores";

/**
 * Gerador de logos: formulário curto -> `logo_gerar`. Primeiro a função diz
 * o custo (sem gerar); só com o "Rodar" da janela de custo ela gera as N
 * variações. O Jev escolhe a melhor e explica: ela vem destacada com o
 * motivo. Cada variação baixa; tudo já fica salvo em Arquivos.
 */

export default function AbaLogos({
  clienteId,
  onCliente,
  clientes,
  onVerArquivos,
}: {
  clienteId: string | null;
  onCliente: (id: string | null) => void;
  clientes: ClienteDoLab[];
  onVerArquivos: () => void;
}) {
  const [form, setForm] = useState({ nome: "", conceito: "", paleta: "", estilo: "", n: 4 });
  const [estimando, setEstimando] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [estimativa, setEstimativa] = useState<number | null>(null);
  const [resultado, setResultado] = useState<ResultadoDaLogo | null>(null);
  const urls = useImagens(resultado ? resultado.variacoes : []);

  const pedido = (): PedidoDeLogo => ({ client_id: clienteId, nome: form.nome.trim(), conceito: form.conceito.trim(), paleta: form.paleta.trim(), estilo: form.estilo.trim(), n: form.n });

  const pedirCusto = async () => {
    if (!form.nome.trim()) {
      toast.info("Falta o nome da marca");
      return;
    }
    setEstimando(true);
    try {
      // Sem confirmado a função só devolve o custo ('confirmacao_necessaria'); nada é gerado.
      const r = await gerarLogo(pedido(), false);
      if (r.variacoes.length) {
        setResultado(r);
        return;
      }
      setEstimativa(r.estimativa_usd ?? 0);
    } catch (e) {
      toast.error("Não deu para estimar o custo", { description: textoDoErro(e) });
    } finally {
      setEstimando(false);
    }
  };

  const confirmar = async () => {
    setRodando(true);
    try {
      const r = await gerarLogo(pedido(), true);
      setResultado(r);
      setEstimativa(null);
      toast.success(`${r.variacoes.length} variações prontas`, { description: r.custo_usd !== null ? `Custo ${usd(r.custo_usd)}. Salvas em Arquivos.` : "Salvas em Arquivos." });
    } catch (e) {
      toast.error("Não deu para gerar as logos", { description: textoDoErro(e) });
    } finally {
      setRodando(false);
    }
  };

  const escolhida = resultado && resultado.escolhida ? resultado.escolhida.indice : null;
  const muda = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: k === "n" ? Math.max(2, Math.min(8, Number(e.target.value) || 4)) : e.target.value }));

  return (
    <div className={espaco.pagina} data-aba-logos="">
      <form
        className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-[880px]"
        onSubmit={(e) => {
          e.preventDefault();
          void pedirCusto();
        }}
      >
        <label className="min-w-0">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Nome</span>
          <input className={campo} value={form.nome} onChange={muda("nome")} aria-label="Nome da marca" />
        </label>
        <label className="min-w-0">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Paleta</span>
          <input className={campo} value={form.paleta} onChange={muda("paleta")} placeholder="Ex.: verde-musgo e creme" aria-label="Paleta" />
        </label>
        <label className="min-w-0 sm:col-span-2">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Conceito</span>
          <textarea className={juntar(campoTexto, "min-h-[64px]")} value={form.conceito} onChange={muda("conceito")} aria-label="Conceito" />
        </label>
        <label className="min-w-0">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Estilo</span>
          <input className={campo} value={form.estilo} onChange={muda("estilo")} placeholder="Ex.: minimalista, geométrico" aria-label="Estilo" />
        </label>
        <label className="min-w-0">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Quantidade</span>
          <input type="number" min={2} max={8} className={campo} value={form.n} onChange={muda("n")} aria-label="Quantidade de variações" />
        </label>
        <div className="flex min-w-0 items-center sm:col-span-2">
          <SeletorDeCliente valor={clienteId} onMudar={onCliente} clientes={clientes} />
          <span className="flex-1" />
          <button type="submit" className={botao.primario} disabled={estimando || rodando}>
            {estimando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Gerar logos
          </button>
        </div>
      </form>

      {resultado && (
        <section className="min-w-0" aria-label="Variações da logo">
          <div className="mb-3 flex min-w-0 items-center">
            <h2 className={juntar(texto.tituloSecao, "flex-1")}>Variações</h2>
            <button type="button" className={botao.icone} onClick={onVerArquivos} aria-label="Ver em Arquivos" title="Ver em Arquivos">
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {resultado.escolhida ? (
            <p className={juntar(texto.corpo, "mb-3")} data-motivo-do-jev="">
              <Star className="mr-1 inline h-4 w-4 text-primary" aria-hidden="true" />
              <span className="font-medium">O Jev escolheu a {resultado.escolhida.indice + 1}ª.</span> {resultado.escolhida.motivo}
            </p>
          ) : null}
          {resultado.aviso_jev ? (
            <p className={juntar(texto.auxiliar, "mb-3 text-warning")} data-aviso-do-jev="">
              {resultado.aviso_jev}
            </p>
          ) : null}
          <div className="grid min-w-0 grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {resultado.variacoes.map((v, i) => {
              const eleita = escolhida === v.indice;
              return (
                <figure key={i} className={juntar("relative min-w-0 overflow-hidden rounded-md border bg-white", eleita ? "border-primary ring-2 ring-primary" : "border-border")} data-variacao={v.indice} data-escolhida-do-jev={eleita ? "" : undefined}>
                  {urls[i] ? <img src={urls[i]} alt={`Variação ${v.indice + 1}`} className="block h-40 w-full object-contain" /> : <div className="h-40" />}
                  <figcaption className="flex min-w-0 items-center border-t border-border bg-background px-2 py-1">
                    <span className={juntar(texto.auxiliar, "flex-1 truncate", eleita && "font-medium text-primary")}>{eleita ? "Escolhida pelo Jev" : `Variação ${v.indice + 1}`}</span>
                    {urls[i] ? (
                      <a href={urls[i]} download={`logo-${form.nome || "marca"}-${v.indice + 1}.png`} target="_blank" rel="noreferrer" className={juntar(botao.icone, "h-7 w-7")} aria-label={`Baixar a variação ${v.indice + 1}`} title="Baixar">
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    ) : null}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      )}

      <JanelaDeCusto
        aberta={estimativa !== null}
        titulo="Gerar logos"
        linhas={estimativa !== null ? [{ id: "logo", nome: `${form.n} variações de logo + escolha do Jev`, custo_usd: estimativa }] : []}
        total={estimativa || 0}
        rodando={rodando}
        onConfirmar={() => void confirmar()}
        onFechar={() => setEstimativa(null)}
      />
    </div>
  );
}
