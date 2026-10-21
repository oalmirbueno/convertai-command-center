import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { campo, texto } from "@/components/sistema/estilos";
import { chamarFuncao } from "@/lib/mesa/api";
import { AvisoDeErro } from "./Custo";
import type { Trabalho } from "./useItensDoMes";

interface ImagemReal {
  arquivo: string; nome: string; url: string; miniatura_url?: string;
  fonte_url: string; licenca?: string; autor?: string;
}
interface ResultadoReal { resultados: ImagemReal[]; avisos?: string[] }
interface AplicacaoReal { precisa_print?: boolean; motivo?: string; fonte?: { nome: string } }
const https = (v?: string) => { try { const u = new URL(v || ""); return u.protocol === "https:" && !u.username && !u.password ? u.href : undefined; } catch { return undefined; } };

/** Busca complementar: a equipe escolhe a fonte; a composição preserva os pixels no Profile. */
export default function ImagensReaisDoDiretor({ trabalho, ordem, bloqueado, onAtualizar, onAbrirTemplate, onAbrirFotos }: {
  trabalho: Trabalho; ordem: number; bloqueado: boolean; onAtualizar: () => void;
  onAbrirTemplate?: () => void; onAbrirFotos?: () => void;
}) {
  const card = trabalho.direcao.cards?.find((c) => c.ordem === ordem);
  const [consulta, setConsulta] = useState((card?.texto_exato || "").replace(/\s+/g, " ").trim().slice(0, 160));
  const [tipo, setTipo] = useState<"imagem" | "logo">("imagem");
  const [url, setUrl] = useState("");
  const [resultado, setResultado] = useState<ResultadoReal | null>(null);
  const [ocupado, setOcupado] = useState(false), [erro, setErro] = useState<unknown>(null), [aviso, setAviso] = useState("");
  const vivo = useRef(true), emCurso = useRef(false);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const travado = bloqueado || ocupado || ["aguardando_agencia", "aguardando_cliente", "aprovado", "agendado"].includes(trabalho.entrega_status || "");
  const executar = async (acao: () => Promise<void>) => {
    if (emCurso.current || travado) return;
    emCurso.current = true; setOcupado(true); setErro(null); setAviso("");
    try { await acao(); } catch (e) { if (vivo.current) setErro(e); }
    finally { emCurso.current = false; if (vivo.current) setOcupado(false); }
  };
  const buscar = () => executar(async () => {
    const r = await chamarFuncao<ResultadoReal>("estudio-arte", { acao: "imagens_reais_buscar", trabalho_id: trabalho.id, ordem, consulta: consulta.trim(), tipo });
    if (vivo.current) setResultado(r);
  });
  const aplicar = (fonte: { arquivo: string } | { url: string }) => executar(async () => {
    const versao = Math.max(0, ...trabalho.cards.filter((c) => c.ordem === ordem).map((c) => c.versao));
    const r = await chamarFuncao<AplicacaoReal>("estudio-arte", { acao: "imagem_real_aplicar", trabalho_id: trabalho.id, ordem, texto_base: card?.texto_exato || "", versao_esperada: versao, tipo, ...fonte });
    if (!vivo.current) return;
    if (r.precisa_print) { setAviso(r.motivo || "Envie a captura da tela em Fotos para usar o painel exato."); return; }
    if (!r.fonte) throw new Error(r.motivo || "A imagem não foi adicionada. Confira a fonte e tente novamente.");
    setAviso(`${r.fonte.nome} adicionada às fontes da lâmina. Selecione a imagem no Template para preservar os pixels.`);
    onAtualizar();
  });
  return <details className="min-w-0 border-b border-border pb-3" aria-label="Imagens reais do diretor">
    <summary className="cursor-pointer text-[12px] font-medium"><ImagePlus className="mr-1.5 inline h-3.5 w-3.5" aria-hidden="true" />Imagens reais · lâmina {ordem}</summary>
    <div className="mt-3 space-y-3">
      <div className="flex items-center"><span className={texto.auxiliar}>Compor com uma fonte real</span><AjudaRecolhida className="ml-1.5" rotulo="Como usar imagens reais">Busque pelo assunto ou pela marca. Confira a origem e a licença antes de escolher. No Template, fotos, logos e telas são compostas sem redesenho. Para ensinar um botão ou configuração com login, envie uma captura atual em Fotos e marque o ponto na prévia do Template.</AjudaRecolhida></div>
      <fieldset disabled={travado} className="space-y-2 disabled:opacity-70">
        <label className="block text-[12px]">Assunto ou marca<Input aria-label="Assunto das imagens reais" value={consulta} maxLength={200} onChange={(e) => { setConsulta(e.target.value); setResultado(null); }} className="mt-1" /></label>
        <label className="block text-[12px]">Tipo de imagem<select aria-label="Tipo de imagem real" value={tipo} onChange={(e) => { setTipo(e.target.value as "imagem" | "logo"); setResultado(null); }} className={`${campo} mt-1`}><option value="imagem">Imagem do assunto</option><option value="logo">Logo ou marca</option></select></label>
        <Button size="sm" variant="outline" disabled={consulta.trim().length < 2} onClick={() => void buscar()}>{ocupado ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1.5 h-3.5 w-3.5" />}Buscar na Wikimedia</Button>
        <div className="text-[11px] text-muted-foreground">Pesquisa sem geração de imagem · sem custo de IA.</div>
        {resultado && <div className="space-y-3" aria-label="Fontes reais encontradas">
          {resultado.resultados.length === 0 && <p className={texto.auxiliar}>Sem imagens. Refine o assunto ou envie a captura em Fotos.</p>}
          {resultado.resultados.slice(0, 6).map((r) => <div key={r.arquivo} className="flex min-w-0 items-start border-t border-border pt-2">
            {https(r.miniatura_url || r.url) && <img src={https(r.miniatura_url || r.url)} alt={r.nome} className="mr-2 h-16 w-20 shrink-0 rounded-md bg-muted object-contain" loading="lazy" referrerPolicy="no-referrer" />}
            <div className="min-w-0 flex-1 space-y-1"><p className="text-[12px] [overflow-wrap:anywhere]">{r.nome}</p>{https(r.fonte_url) && <a href={https(r.fonte_url)} target="_blank" rel="noopener noreferrer" className="text-[11px] text-primary underline">Conferir fonte e licença</a>}<p className="text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{[r.autor, r.licenca].filter(Boolean).join(" · ")}</p><Button size="sm" variant="ghost" onClick={() => void aplicar({ arquivo: r.arquivo })}>Usar na lâmina</Button></div>
          </div>)}
          {resultado.avisos?.map((a) => <p key={a} className={texto.auxiliar}>{a}</p>)}
        </div>}
        <details><summary className="cursor-pointer text-[12px] text-muted-foreground">Usar link de uma imagem pública</summary><div className="mt-2 space-y-2"><Input aria-label="Link da imagem real" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/imagem.png" maxLength={1800} /><Button size="sm" variant="outline" disabled={!https(url)} onClick={() => void aplicar({ url: url.trim() })}>Adicionar imagem do link</Button><p className={texto.auxiliar}>Painel com login: envie a captura em Fotos.</p></div></details>
      </fieldset>
      {erro ? <AvisoDeErro erro={erro} /> : null}
      {aviso && <p role="status" className={texto.auxiliar}>{aviso}</p>}
      <div className="flex flex-wrap">{onAbrirFotos && <Button size="sm" variant="ghost" className="mr-1" onClick={onAbrirFotos}>Enviar print em Fotos</Button>}{onAbrirTemplate && <Button size="sm" variant="ghost" onClick={onAbrirTemplate}>Abrir Template</Button>}</div>
    </div>
  </details>;
}
