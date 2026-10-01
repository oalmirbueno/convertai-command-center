import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, Image as ImagemIcone, Link2, Loader2, ScanEye, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ImagemDaMesa, useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { padraoPara, usd } from "@/lib/mesa/api";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { rotuloDoAtributo } from "../../../supabase/functions/_shared/site-metodo";
import { PreencherComIA } from "@/components/sistema";
import { chamarSite, type LinhaDoSite, useGuardarSite } from "./siteApi";
import { listaDoValor } from "./CampoComIA";
import { useBarraDaEtapa } from "./BarraDaEtapa";
// Frente MOD (30/09): o navegador do agente captura a tela inteira da referência (com o Confirmar do dono).
import { BotaoDoNavegador, TarefasDoNavegador } from "@/components/agentes/NavegadorDoAgente";

type Foto = { id: string; storage_bucket: string; storage_path: string; nome: string };

const nomeSeguro = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

/**
 * Etapa 2: referências (URL, print e foto do acervo). "Ler as referências"
 * manda para a visão descrever e o Jev escolher o DNA (3 a 5 atributos numa
 * lista fechada), com o custo antes.
 */
export default function EtapaReferencias({ site, onIrPara }: { site: LinhaDoSite; onIrPara: (etapa: string) => void }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const [url, setUrl] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verAcervo, setVerAcervo] = useState(false);
  const arquivo = useRef<HTMLInputElement | null>(null);
  const refs = (site.referencias || []).filter((r: any) => !r.arquivada);
  // Modelo na hora (SIT2): o leitor padrão, trocável por qualquer modelo de texto com visão do catálogo.
  const [leitorId, setLeitorId] = useState<string>(() => {
    const m = padraoPara(catalogo, "leitura");
    return m ? m.id : "";
  });
  const leitor = catalogo.find((m) => m.id === leitorId && m.ativo) || padraoPara(catalogo, "leitura");
  const adicionadasPelaIA = useRef<string[]>([]);

  /** Sugestões do ✨ (com a web como fonte): cada endereço entra como referência; o Desfazer arquiva as que entraram. */
  const aplicarSugestoes = async (valor: unknown) => {
    const urls = listaDoValor(valor).filter((u) => /^https?:\/\//i.test(u)).slice(0, 6);
    if (!urls.length) throw new Error("Nenhum endereço válido nas sugestões.");
    const antes = new Set((site.referencias || []).map((r: any) => r.id));
    let ultimo: LinhaDoSite | null = null;
    for (const u of urls) {
      const d = await chamarSite<{ site: LinhaDoSite }>("referencia_adicionar", { site_id: site.id, tipo: "url", url: u });
      ultimo = d.site;
    }
    if (ultimo) {
      guardar(ultimo);
      adicionadasPelaIA.current = (ultimo.referencias || []).map((r: any) => r.id).filter((id: string) => !antes.has(id));
    }
  };
  const desfazerSugestoes = async () => {
    let ultimo: LinhaDoSite | null = null;
    for (const id of adicionadasPelaIA.current) {
      const d = await chamarSite<{ site: LinhaDoSite }>("referencia_arquivar", { site_id: site.id, referencia_id: id });
      ultimo = d.site;
    }
    adicionadasPelaIA.current = [];
    if (ultimo) guardar(ultimo);
  };
  const fotos = useQuery({ queryKey: ["mesa-site", "acervo", site.id], enabled: verAcervo, queryFn: () => chamarSite<{ fotos: Foto[] }>("fotos_reais", { site_id: site.id }) });

  const rodar = async (rotulo: string, fn: () => Promise<{ site?: LinhaDoSite } | void>) => {
    setOcupado(rotulo);
    try {
      const d = await fn();
      if (d && d.site) guardar(d.site);
    } catch (e) {
      avisarErro(e, rotulo);
    } finally {
      setOcupado(null);
    }
  };

  const adicionarUrl = () =>
    rodar("A referência não entrou", async () => {
      const d = await chamarSite<{ site: LinhaDoSite }>("referencia_adicionar", { site_id: site.id, tipo: "url", url: url.trim() });
      setUrl("");
      return d;
    });

  const enviarPrints = (files: FileList | null) => {
    if (!files || !files.length) return;
    void rodar("O print não subiu", async () => {
      let ultimo: { site: LinhaDoSite } | undefined;
      for (const f of Array.from(files).slice(0, 6)) {
        if (f.type.indexOf("image/") !== 0) continue;
        const path = `${clientId}/site/${site.id}/referencias/${Date.now().toString(36)}-${nomeSeguro(f.name)}`;
        const { error } = await supabase.storage.from("mesa").upload(path, f, { contentType: f.type, upsert: false });
        if (error) throw error;
        ultimo = await chamarSite<{ site: LinhaDoSite }>("referencia_adicionar", { site_id: site.id, tipo: "print", path, nome: f.name });
      }
      return ultimo;
    });
  };

  const ler = () =>
    rodar("As referências não foram lidas", async () => {
      const d = await chamarSite<{ site: LinhaDoSite; falhas: string[]; aviso_jev: string | null; custo_usd: number }>("referencias_ler", { site_id: site.id, modelo_id: leitor ? leitor.id : undefined });
      atualizarCusto();
      if (d.aviso_jev || (d.falhas && d.falhas.length)) avisarErro(new Error([d.aviso_jev].concat(d.falhas || []).filter(Boolean).join(" ")), "Leitura com aviso");
      return d;
    });

  const imagensNaLeitura = refs.filter((r: any) => r.tipo !== "url").length + refs.filter((r: any) => r.tipo === "url").length;
  const dna = site.dna && Array.isArray(site.dna.atributos) ? site.dna : null;
  // UXS 30/09: ler é a ação principal enquanto há referência não lida; depois, o Seguir da barra.
  const naoLidas = refs.filter((r: any) => !r.lida_em).length;
  useBarraDaEtapa({ estado: refs.length ? `${refs.length} referência${refs.length === 1 ? "" : "s"}${naoLidas ? ` · ${naoLidas} por ler` : ""}` : "Opcional", pendente: naoLidas > 0, ocupado: ocupado === "As referências não foram lidas" });

  return (
    <div className="min-w-0 space-y-6" data-etapa-referencias="">
      <Secao
        titulo="Referências"
        descricao={`${refs.length} de 12`}
        ajuda="Sites que o cliente admira (URL), prints e fotos do acervo. A página vira texto e a imagem de compartilhamento; prints e fotos vão direto para a visão. Nada é copiado: a leitura só descreve o estilo. O ✨ sugere sites de referência do mesmo nicho pela web, com a fonte, e só entra o que você aplicar."
        acao={
          <>
          <span className="mr-2 inline-flex">
            <PreencherComIA
              papel="site"
              clientId={clientId}
              marcaId={marca ? marca.id : null}
              campos={[{ chave: "referencias.sugeridas", rotulo: "Sites de referência", tipo: "lista", maximo: 5, valorAtual: refs.filter((r: any) => r.tipo === "url").map((r: any) => r.url), dica: "endereços https de sites reais e premium do mesmo nicho ou do nível pedido; só endereços que aparecem nas fontes da web, nunca inventados" }]}
              fontes={["contexto", "briefing", "web"]}
              rotulo="Sugerir referências"
              onAplicar={(v) => aplicarSugestoes(v["referencias.sugeridas"])}
              onDesfazer={() => desfazerSugestoes()}
            />
          </span>
          <button type="button" className={naoLidas > 0 ? botao.primario : botao.secundario} disabled={!refs.length || !!ocupado} onClick={() => void ler()} data-ler-referencias="">
            {ocupado === "As referências não foram lidas" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ScanEye className="mr-1 h-3.5 w-3.5" />}
            Ler as referências
          </button>
          </>
        }
      >
        <div className="flex min-w-0 flex-wrap items-center">
          <form
            className="mb-2 mr-2 flex min-w-0 flex-1 items-center"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) void adicionarUrl();
            }}
          >
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://site-que-o-cliente-admira.com" className={juntar(campo, "mr-2 min-w-[200px] flex-1")} aria-label="Endereço da referência" />
            <button type="submit" className={botao.secundario} disabled={!url.trim() || !!ocupado}>
              <Link2 className="mr-1 h-3.5 w-3.5" />
              Adicionar
            </button>
          </form>
          <input ref={arquivo} type="file" accept="image/*" multiple className="hidden" onChange={(e) => enviarPrints(e.target.files)} />
          <button type="button" className={juntar(botao.secundario, "mb-2 mr-2")} disabled={!!ocupado} onClick={() => arquivo.current && arquivo.current.click()}>
            <Upload className="mr-1 h-3.5 w-3.5" />
            Prints
          </button>
          <button type="button" className={juntar(botao.discreto, "mb-2")} onClick={() => setVerAcervo(!verAcervo)} aria-expanded={verAcervo} data-acervo-das-referencias="">
            <ImagemIcone className="mr-1 h-3.5 w-3.5" />
            Acervo{verAcervo && fotos.data ? ` · ${fotos.data.fotos.length} fotos` : ""}
          </button>
        </div>
        {/* UXS 30/09: o acervo abre logo abaixo dos botões, dentro da seção (antes abria lá embaixo, depois da lista). */}
        {verAcervo && (
          <div className="min-w-0 pb-3" data-acervo-aberto="">
            {fotos.isLoading && <Carregando forma="grade" linhas={6} rotulo="Lendo o acervo" />}
            {fotos.isError && <EstadoDeErro titulo="O acervo não foi lido." acao={<button type="button" className={botao.discreto} onClick={() => void fotos.refetch()}>Tentar de novo</button>} />}
            {fotos.data && !fotos.data.fotos.length && <EstadoVazio compacto titulo="Nenhuma foto no acervo da marca." />}
            <div className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {(fotos.data ? fotos.data.fotos : []).slice(0, 36).map((f) => (
                <button key={f.id} type="button" className="relative min-w-0 overflow-hidden rounded-md" title={`Usar ${f.nome} como referência`} onClick={() => void rodar("A foto não entrou", () => chamarSite("referencia_adicionar", { site_id: site.id, tipo: "acervo", imagem_id: f.id }))}>
                  <ImagemDaMesa caminho={f.storage_path} bucket={f.storage_bucket} alt={f.nome} className="h-20 w-full" />
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
          <SeletorDeModelo catalogo={catalogo} tipo="texto" valor={leitor ? leitor.id : ""} onChange={setLeitorId} rotulo="Leitor das referências" />
        </div>
        <div className="min-w-0 truncate">{leitor && refs.length > 0 && <EstimativaInline partes={[{ modeloId: leitor.id, tipo: "texto", tokensEntrada: 3000 + 1600 * Math.min(6, imagensNaLeitura), tokensSaida: 1600 }]} />}</div>
        {!refs.length && <EstadoVazio compacto titulo="Nenhuma referência ainda." descricao="Cole um endereço ou suba prints." />}
        {refs.length > 0 && (
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {refs.map((r: any) => (
              <li key={r.id} className={lista.linha}>
                {r.path ? <ImagemDaMesa caminho={r.path} bucket={r.bucket || "mesa"} alt={r.nome} className="mr-3 h-10 w-16 shrink-0 rounded" /> : <Link2 className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" />}
                <span className="mr-2 min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate")}>{r.nome}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>{r.lida_em ? (r.leitura && r.leitura.titulo) || "lida" : "ainda não lida"}</span>
                </span>
                {r.tipo === "url" && r.url && <BotaoDoNavegador caso="captura_site" clientId={clientId} origem="mesa_site" url={String(r.url)} rotulo="Capturar a tela inteira" compacto />}
                <button type="button" className={botao.icone} aria-label={`Arquivar ${r.nome}`} onClick={() => void rodar("Não foi possível arquivar", () => chamarSite("referencia_arquivar", { site_id: site.id, referencia_id: r.id }))}>
                  <Archive className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <TarefasDoNavegador clientId={clientId} origem="mesa_site" titulo="Capturas de tela inteira" />

      {dna && (
        <Secao
          titulo="DNA lido"
          descricao={dna.fonte === "jev" ? "Escolhido pelo Jev" : "Escolhido à mão"}
          ajuda="A visão descreveu as referências e o Jev escolheu de 3 a 5 atributos numa lista fechada, mais o movimento, o nível e o nicho. Ajuste na Direção."
          acao={
            <button type="button" className={botao.secundario} onClick={() => onIrPara("direcao")}>
              Ajustar na Direção
            </button>
          }
        >
          <div className="flex flex-wrap">
            {dna.atributos.map((a: { id: string; prob: number | null }) => (
              <span key={a.id} className={juntar(etiqueta, "mb-1.5 mr-1.5 bg-primary/10 text-primary")}>
                {rotuloDoAtributo(a.id)}
                {typeof a.prob === "number" ? ` ${Math.round(a.prob * 100)}%` : ""}
              </span>
            ))}
          </div>
          {dna.observacoes && <p className={juntar(texto.auxiliar, "line-clamp-3 whitespace-normal")}>{String(dna.observacoes).slice(0, 400)}</p>}
          {site.custo_usd ? <p className={texto.auxiliar}>Custo do site até aqui: {usd(Number(site.custo_usd))}</p> : null}
        </Secao>
      )}
    </div>
  );
}
