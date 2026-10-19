import { useState } from "react";
import { Check, Loader2, ScanSearch, X } from "lucide-react";
import Secao from "@/components/sistema/Secao";
import { useAvisarErro } from "@/components/mesa/Custo";
import { botao, campo, campoTexto, juntar, lista, texto } from "@/components/sistema/estilos";
import { chamarSite } from "./siteApi";
import { type AchadoDoLink, achadosDaLeitura, type LeituraDoLink, registroDaLeitura, ROTULO_DO_DESTINO } from "./leituraDoLink";

/**
 * "Ler a página do cliente pelo link" (19/10/2026, aprendido com o Gravyx):
 * o dono cola o site atual, o Instagram ou a página de vendas; o servidor lê
 * a página pública (robots.txt, prazo, só HTML; sem IA e sem custo) e a tela
 * mostra o que achou: nome, oferta, serviços, depoimentos, contato, cores e
 * as imagens principais. Cada achado tem a caixa para usar e o texto para
 * ajustar; "Usar no briefing" acrescenta às respostas (nunca apaga) e guarda
 * a leitura no briefing (pagina_lida) para o diretor de site.
 */
export default function LerPaginaDoCliente({
  siteId,
  lidaAntes,
  onUsar,
}: {
  siteId: string;
  /** A última leitura guardada (briefing.pagina_lida), só para mostrar de onde veio. */
  lidaAntes?: { url?: string; lida_em?: string } | null;
  onUsar: (escolhidos: AchadoDoLink[], registro: ReturnType<typeof registroDaLeitura>) => Promise<void>;
}) {
  const avisarErro = useAvisarErro();
  const [url, setUrl] = useState("");
  const [lendo, setLendo] = useState(false);
  const [usando, setUsando] = useState(false);
  const [leitura, setLeitura] = useState<LeituraDoLink | null>(null);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [achados, setAchados] = useState<AchadoDoLink[]>([]);
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});

  const ler = async () => {
    const alvo = url.trim();
    if (!alvo || lendo) return;
    setLendo(true);
    setMotivo(null);
    try {
      const d = await chamarSite<{ leitura: LeituraDoLink | null; motivo: string | null }>("link_ler", { site_id: siteId, url: alvo });
      setLeitura(d.leitura || null);
      setMotivo(d.motivo || null);
      const novos = d.leitura ? achadosDaLeitura(d.leitura) : [];
      setAchados(novos);
      const m: Record<string, boolean> = {};
      novos.forEach((a) => (m[a.id] = true));
      setMarcados(m);
    } catch (e) {
      avisarErro(e, "A página não foi lida");
    } finally {
      setLendo(false);
    }
  };

  const descartar = () => {
    setLeitura(null);
    setAchados([]);
    setMarcados({});
    setMotivo(null);
  };

  const escolhidos = achados.filter((a) => marcados[a.id] && a.texto.trim());

  const usar = async () => {
    if (!leitura || !escolhidos.length) return;
    setUsando(true);
    try {
      await onUsar(escolhidos, registroDaLeitura(leitura));
      descartar();
      setUrl("");
    } catch (e) {
      avisarErro(e, "O briefing não foi salvo");
    } finally {
      setUsando(false);
    }
  };

  const ultima = lidaAntes && lidaAntes.url ? lidaAntes.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;

  return (
    <Secao
      titulo="Ler a página do cliente"
      descricao={ultima ? `Sem custo de IA · última leitura: ${ultima}` : "Sem custo de IA"}
      ajuda="Cole o site atual, o Instagram (@perfil ou o link) ou a página de vendas do cliente. A leitura é da página pública, respeita o robots.txt do site, não usa IA e não custa nada. Você vê o que foi achado, desmarca o que não serve e ajusta o texto; Usar no briefing acrescenta às respostas (nada é apagado) e as cores vão para a observação da direção. Sites montados só no navegador e o Instagram (que bloqueia robô) podem trazer pouco: aí cole a bio no briefing."
      recolher="mesa-site:briefing:ler-link"
    >
      <form
        className="flex min-w-0 items-center"
        onSubmit={(ev) => {
          ev.preventDefault();
          void ler();
        }}
        data-ler-link=""
      >
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="cliente.com.br, @perfil ou link da página de vendas" className={juntar(campo, "mr-2 flex-1")} aria-label="Link da página do cliente" inputMode="url" autoComplete="off" disabled={lendo} />
        <button type="submit" className={botao.icone} aria-label="Ler a página" title="Ler a página (sem custo de IA)" disabled={lendo || !url.trim()} data-ler-link-botao="">
          {lendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
        </button>
      </form>

      {motivo && <p className={juntar(texto.auxiliar, "whitespace-normal", leitura ? "text-amber-700 dark:text-amber-400" : "text-destructive")} data-motivo-da-leitura="">{motivo}</p>}

      {leitura && (
        <div className="min-w-0" data-leitura-do-link={leitura.host}>
          <div className="flex min-w-0 items-center">
            <span className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>
              Lido em {leitura.host || leitura.url}: confira e desmarque o que não serve
            </span>
            <button type="button" className={botao.icone} aria-label="Descartar a leitura" title="Descartar a leitura" onClick={descartar} disabled={usando}>
              <X className="h-4 w-4" />
            </button>
          </div>
          {!achados.length && <p className={texto.auxiliar}>Nada aproveitável no HTML desta página.</p>}
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {achados.map((a) => (
              <li key={a.id} className="min-w-0 px-2 py-2" data-achado={a.id}>
                <label className="flex min-w-0 cursor-pointer items-center">
                  <input type="checkbox" className="mr-2 shrink-0" checked={!!marcados[a.id]} onChange={(e) => setMarcados((m) => ({ ...m, [a.id]: e.target.checked }))} aria-label={`Usar ${a.rotulo}`} />
                  <span className={juntar(texto.rotulo, "mr-2 shrink-0 text-foreground")}>{a.rotulo}</span>
                  <span className={juntar(texto.auxiliar, "min-w-0 truncate")}>vai para: {ROTULO_DO_DESTINO[a.destino]}</span>
                </label>
                {a.id === "cores" && (
                  <span className="mt-1.5 flex flex-wrap" aria-hidden="true">
                    {leitura.cores.map((c) => (
                      <span key={c} className="mb-1 mr-1.5 inline-block h-5 w-5 rounded border border-border" style={{ background: c }} title={c} />
                    ))}
                  </span>
                )}
                <textarea
                  value={a.texto}
                  onChange={(e) => setAchados((l) => l.map((x) => (x.id === a.id ? { ...x, texto: e.target.value } : x)))}
                  rows={a.texto.length > 140 ? 3 : 2}
                  maxLength={1500}
                  aria-label={`Texto de ${a.rotulo}`}
                  className={juntar(campoTexto, "mt-1.5 min-h-[56px]")}
                  disabled={!marcados[a.id]}
                />
              </li>
            ))}
          </ul>
          {(leitura.imagens.length > 0 || leitura.logo) && (
            <div className="min-w-0 pt-2">
              <span className={juntar(texto.rotulo, "block")}>Imagens principais (ficam guardadas na leitura)</span>
              <ul className="mt-1.5 grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-6" data-imagens-lidas="">
                {(leitura.logo ? [{ url: leitura.logo, alt: "Logo" }] : []).concat(leitura.imagens).slice(0, 6).map((i) => (
                  <li key={i.url} className="min-w-0">
                    <img src={i.url} alt={i.alt || "Imagem da página"} title={i.alt || undefined} loading="lazy" referrerPolicy="no-referrer" className="h-16 w-full rounded-md border border-border object-cover" />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex min-w-0 flex-wrap items-center pt-3">
            <button type="button" className={juntar(botao.primario, "mr-2")} disabled={usando || !escolhidos.length} onClick={() => void usar()} data-usar-leitura="">
              {usando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
              Usar no briefing
            </button>
            <span className={texto.auxiliar}>{escolhidos.length} de {achados.length} marcados</span>
          </div>
        </div>
      )}
    </Secao>
  );
}
