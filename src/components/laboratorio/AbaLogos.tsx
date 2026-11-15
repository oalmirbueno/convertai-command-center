import { useState } from "react";
import { toast } from "sonner";
import { Brush, Download, FolderOpen, Loader2, Sparkles, Star } from "lucide-react";
import { botao, campo, campoTexto, juntar, superficie, texto } from "@/components/sistema";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { gerarLogo, type PedidoDeLogo, type ResultadoDaLogo } from "@/lib/laboratorio/api";
import JanelaDeCusto from "./JanelaDeCusto";
import { useImagens } from "./ResultadoDoNo";
import { SeletorDeCliente, type ClienteDoLab } from "./Seletores";
import { CirculoDoIcone, HACHURA, ZonaVazia, botaoEmCirculo } from "./visual";

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
    // v4 (15/11/2026): o pedido num cartão à esquerda (título com ícone em círculo, campos e um só botão) e as
    // variações à direita; antes de gerar, a área das variações fica reservada como zona hachurada (nada pula
    // quando o resultado chega). No celular empilha.
    <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]" data-aba-logos="">
      <form
        className={juntar(superficie.painel, "grid min-w-0 grid-cols-1 gap-3 rounded-[28px] p-5 sm:grid-cols-2 sm:p-6")}
        onSubmit={(e) => {
          e.preventDefault();
          void pedirCusto();
        }}
      >
        <div className="mb-1 flex min-w-0 items-center sm:col-span-2">
          <CirculoDoIcone tinta className="mr-3">
            <Brush className="h-4 w-4" />
          </CirculoDoIcone>
          <h2 className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")}>Nova logo</h2>
          <SeletorDeCliente valor={clienteId} onMudar={onCliente} clientes={clientes} />
        </div>
        <label className="min-w-0 sm:col-span-2">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Nome</span>
          <input className={campo} value={form.nome} onChange={muda("nome")} aria-label="Nome da marca" />
        </label>
        <label className="min-w-0 sm:col-span-2">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Conceito</span>
          <textarea className={juntar(campoTexto, "min-h-[84px]")} value={form.conceito} onChange={muda("conceito")} aria-label="Conceito" />
        </label>
        <label className="min-w-0 sm:col-span-2">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Paleta</span>
          <input className={campo} value={form.paleta} onChange={muda("paleta")} placeholder="Ex.: verde-musgo e creme" aria-label="Paleta" />
        </label>
        <label className="min-w-0">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Estilo</span>
          <input className={campo} value={form.estilo} onChange={muda("estilo")} placeholder="Ex.: minimalista" aria-label="Estilo" />
        </label>
        <label className="min-w-0">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Quantidade</span>
          <input type="number" min={2} max={8} className={campo} value={form.n} onChange={muda("n")} aria-label="Quantidade de variações" />
        </label>
        <button type="submit" className={juntar(botao.primario, "mt-2 h-11 w-full sm:col-span-2")} disabled={estimando || rodando}>
          {estimando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          Gerar logos
        </button>
      </form>

      {resultado ? (
        <section className="min-w-0" aria-label="Variações da logo">
          <div className="mb-3 flex min-w-0 items-center">
            <h2 className={juntar(texto.tituloSecao, "flex-1")}>Variações</h2>
            <button type="button" className={botaoEmCirculo} onClick={onVerArquivos} aria-label="Ver em Arquivos" title="Ver em Arquivos">
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {resultado.escolhida ? (
            <p className={juntar(texto.corpo, "mb-3 flex min-w-0 items-start rounded-[20px] bg-accent-soft p-3")} data-motivo-do-jev="">
              <span className="mr-2.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden="true">
                <Star className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 self-center">
                <span className="font-medium">O Jev escolheu a {resultado.escolhida.indice + 1}ª.</span> {resultado.escolhida.motivo}
              </span>
            </p>
          ) : null}
          {resultado.aviso_jev ? (
            <p className={juntar(texto.auxiliar, "mb-3 text-warning")} data-aviso-do-jev="">
              {resultado.aviso_jev}
            </p>
          ) : null}
          <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {resultado.variacoes.map((v, i) => {
              const eleita = escolhida === v.indice;
              return (
                <figure key={i} className={juntar("relative min-w-0 overflow-hidden rounded-[22px] bg-card p-2 shadow-card", eleita && "ring-2 ring-primary")} data-variacao={v.indice} data-escolhida-do-jev={eleita ? "" : undefined}>
                  <div className="overflow-hidden rounded-[16px] bg-white">{urls[i] ? <img src={urls[i]} alt={`Variação ${v.indice + 1}`} className="block h-40 w-full object-contain" /> : <div className="h-40" style={HACHURA} />}</div>
                  <figcaption className="flex min-w-0 items-center px-1.5 pb-0.5 pt-2">
                    <span className={juntar(texto.auxiliar, "flex-1 truncate font-medium text-foreground")}>{eleita ? "Escolhida pelo Jev" : `Variação ${v.indice + 1}`}</span>
                    {urls[i] ? (
                      <a href={urls[i]} download={`logo-${form.nome || "marca"}-${v.indice + 1}.png`} target="_blank" rel="noreferrer" className={juntar(botaoEmCirculo, "h-8 w-8")} aria-label={`Baixar a variação ${v.indice + 1}`} title="Baixar">
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    ) : null}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>
      ) : (
        <ZonaVazia icone={<Brush className="h-5 w-5" />} titulo="As variações aparecem aqui" descricao="O Jev escolhe a melhor e explica por quê. Tudo fica salvo em Arquivos." className="min-h-[320px] lg:min-h-[468px]" data-logos-sem-resultado="" />
      )}

      <JanelaDeCusto
        aberta={estimativa !== null}
        creditos={false}
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
