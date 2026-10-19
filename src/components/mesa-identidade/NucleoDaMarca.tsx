import { useMemo, useState, type ReactNode } from "react";
import { Globe, Layers, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { JanelaCentral } from "@/components/sistema";
import { botao, campo, foco, juntar, lista, texto, toqueCompacto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { nucleoDaMarca, type NucleoDaMarca as Nucleo } from "../../../supabase/functions/mesa-identidade/modulos/nucleo-da-marca";
import type { LeituraWeb } from "../../../supabase/functions/mesa-identidade/modulos/leitura-web";
import { chamarIdentidade, type ProjetoDeIdentidade } from "./identidadeApi";
import { useProjetoDaMesa } from "./Comuns";

/**
 * Núcleo da marca (19/10/2026). Dono: "melhore a inteligência da área de
 * identidade". O contexto único que vai junto em TODA geração da mesa
 * (naming, slogans, conceito, paletas, fontes, logo e brandbook), montado
 * sozinho do que o projeto já decidiu. Fica no fio da marca, no alto de cada
 * etapa: o ícone abre a janela central com cada peça e o que ainda falta, e
 * lê o site e o Instagram públicos do cliente (sem custo, sem login) para o
 * começo do projeto já saber o que a marca diz de si.
 */

/** O núcleo da tela (o mesmo módulo que a função usa). */
export function useNucleoDaMarca(): Nucleo {
  const mesa = useMesa();
  const { projeto } = useProjetoDaMesa();
  return useMemo(() => nucleoDaMarca(projeto.dados || {}, mesa.clientName || projeto.titulo), [projeto.dados, projeto.titulo, mesa.clientName]);
}

function Linha({ rotulo, children, chave }: { rotulo: string; children: ReactNode; chave: string }) {
  return (
    <li className={juntar(lista.linha, "items-start py-1.5")} data-peca-do-nucleo={chave}>
      <span className={juntar(texto.rotulo, "w-28 shrink-0 pt-0.5")}>{rotulo}</span>
      <span className={juntar(texto.corpo, "min-w-0 flex-1 whitespace-normal break-words")}>{children}</span>
    </li>
  );
}

export default function NucleoDaMarca() {
  const { projeto, guardar } = useProjetoDaMesa();
  const n = useNucleoDaMarca();
  const salvos = ((projeto.dados.nucleo || {}) as { links?: { site?: string | null; instagram?: string | null }; web?: LeituraWeb }) || {};
  const [aberta, setAberta] = useState(false);
  const [site, setSite] = useState(salvos.links && salvos.links.site ? salvos.links.site : "");
  const [instagram, setInstagram] = useState(salvos.links && salvos.links.instagram ? salvos.links.instagram : "");
  const [lendo, setLendo] = useState(false);
  const decididas = 6 - n.faltam.length;

  const ler = async () => {
    setLendo(true);
    try {
      const r = await chamarIdentidade<{ projeto: ProjetoDeIdentidade; leitura: LeituraWeb; avisos: string[] }>("marca_ler_links", { projeto_id: projeto.id, site: site.trim() || undefined, instagram: instagram.trim() || undefined });
      guardar(r.projeto);
      const lidos = [r.leitura.site ? "site" : "", r.leitura.instagram ? "Instagram" : ""].filter(Boolean);
      if (lidos.length) toast.success(`Lido: ${lidos.join(" e ")}`, { description: r.avisos.length ? r.avisos.join(" ") : "Entra no núcleo de todas as gerações." });
      else toast.warning("Nada foi lido", { description: r.avisos.join(" ") || undefined });
      const links = ((r.projeto.dados.nucleo || {}) as { links?: { site?: string | null; instagram?: string | null } }).links;
      if (links) {
        if (links.site) setSite(links.site);
        if (links.instagram) setInstagram(links.instagram);
      }
    } catch (e) {
      toast.error("O site e o Instagram não foram lidos", { description: textoDoErro(e) });
    } finally {
      setLendo(false);
    }
  };

  const vazio = (t: string) => <span className="text-muted-foreground">{t}</span>;

  return (
    <>
      {/* Só ícone (nome no title e no leitor de tela), como as ações secundárias do painel. */}
      <button
        type="button"
        className={juntar(toqueCompacto, "ml-1 inline-flex h-7 shrink-0 items-center rounded-md px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground", foco)}
        onClick={() => setAberta(true)}
        aria-label={`Núcleo da marca: ${decididas} de 6 peças decididas. Ver o que vai junto em toda geração`}
        title="Núcleo da marca: o que vai junto em toda geração"
        data-abrir-nucleo=""
      >
        <Layers className="h-3.5 w-3.5" aria-hidden="true" />
        <span className={juntar(texto.etiqueta, "ml-1 tabular-nums")}>{decididas}/6</span>
      </button>

      <JanelaCentral
        aberta={aberta}
        onMudar={setAberta}
        titulo="Núcleo da marca"
        icone={<Layers className="h-4 w-4" />}
        descricao={n.faltam.length ? `Ainda não decidido: ${n.faltam.join(", ")}` : "Tudo decidido"}
        ajuda="Montado sozinho do que o projeto já decidiu (estratégia, nome, conceito, paleta, fontes e tom) e das referências. Vai junto em toda geração da mesa: nomes, slogans, conceito, paletas, fontes, logo e brandbook. Para mudar uma peça, mude na etapa dela."
        largura="md"
        rodape={
          <div className="flex min-w-0 flex-wrap items-center justify-end" data-ler-links="">
            <input className={juntar(campo, "m-1 h-8 min-w-0 flex-1 basis-40")} value={site} maxLength={300} placeholder="Site (opcional)" aria-label="Site do cliente" onChange={(e) => setSite(e.target.value)} />
            <input className={juntar(campo, "m-1 h-8 min-w-0 flex-1 basis-32")} value={instagram} maxLength={120} placeholder="@ do Instagram" aria-label="Instagram do cliente" onChange={(e) => setInstagram(e.target.value)} />
            <span className={juntar(texto.auxiliar, "m-1")}>Sem custo</span>
            <button type="button" className={juntar(botao.icone, "m-1 disabled:opacity-50")} onClick={() => void ler()} disabled={lendo} aria-label="Ler o site e o Instagram públicos" title="Ler o site e o Instagram públicos (sem login, sem custo)" data-ler-site-instagram="">
              {lendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
            </button>
          </div>
        }
      >
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Peças do núcleo da marca">
          <Linha rotulo="Nome" chave="nome">{n.nome || vazio("sem nome")}{n.faltam.indexOf("nome") >= 0 && n.nome ? <span className="text-muted-foreground"> (do cliente; o naming ainda não decidiu)</span> : null}</Linha>
          <Linha rotulo="Tagline" chave="tagline">{n.tagline || vazio("sem tagline")}</Linha>
          <Linha rotulo="Estratégia" chave="estrategia">
            {n.arquetipo || n.posicionamento ? (
              <>
                {n.arquetipo && <span className="font-medium">{n.arquetipo}. </span>}
                {n.posicionamento}
                {n.publico && <span className="block text-muted-foreground">Para: {n.publico}</span>}
              </>
            ) : (
              vazio("sem estratégia")
            )}
          </Linha>
          <Linha rotulo="Tom" chave="tom">{n.tom.length ? n.tom.join(", ") : vazio("sem tom")}</Linha>
          <Linha rotulo="Conceito" chave="conceito">{n.conceito ? `${n.conceito.nome}: ${n.conceito.ideia}` : vazio("sem caminho escolhido")}</Linha>
          <Linha rotulo="Paleta" chave="paleta">
            {n.paleta.length ? (
              <span className="inline-flex flex-wrap items-center">
                {n.paleta.map((c) => (
                  <span key={c.hex} className="mb-1 mr-1 inline-block h-5 w-5 rounded-full border border-border" style={{ background: c.hex }} title={`${c.nome || c.hex} ${c.hex} (${c.papel})`} />
                ))}
                {n.paleta_do_caminho && <span className="text-muted-foreground">do conceito</span>}
              </span>
            ) : (
              vazio("sem paleta")
            )}
          </Linha>
          <Linha rotulo="Fontes" chave="fontes">{n.fontes.length ? `${n.fontes.map((t) => t.familia).filter((x, i, l) => l.indexOf(x) === i).join(" + ")}${n.fontes_do_caminho ? " (do conceito)" : ""}` : vazio("sem fontes")}</Linha>
          <Linha rotulo="Referências" chave="referencias">
            {n.gosta.length || n.referencias.length ? [...n.gosta, ...n.referencias].slice(0, 8).join("; ") : vazio("sem referências")}
            {n.evita.length > 0 && <span className="block text-muted-foreground">Evitar: {n.evita.join(", ")}</span>}
          </Linha>
          <Linha rotulo="Site e Instagram" chave="web">
            {n.web ? (
              <>
                {n.web.site && <span className="block">Site: {n.web.site}</span>}
                {n.web.instagram && <span className="block">Instagram: {n.web.instagram}</span>}
                {n.web.bio && <span className="block text-muted-foreground">Bio: {n.web.bio}</span>}
              </>
            ) : (
              vazio(salvos.web ? "lido, sem texto público" : "ainda não lido")
            )}
          </Linha>
          <Linha rotulo="Logo" chave="logo">{n.logo.caminho ? (n.logo.origem === "gerada" ? "gerada e escolhida" : "enviada pela equipe") : vazio("sem logo")}</Linha>
        </ul>
      </JanelaCentral>
    </>
  );
}
