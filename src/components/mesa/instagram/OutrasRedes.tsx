import { useState } from "react";
import { Link } from "react-router-dom";
import { Archive, Check, ExternalLink, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { useMesa } from "../MesaContexto";
import { enderecoDaRede, redePorChave, REDES_SOCIAIS, type ChaveDaRede } from "../../../../supabase/functions/_shared/instagram-do-cliente";
import { chamarInstagram, type PainelDoInstagram } from "./instagramApi";

/**
 * Outras redes do cliente. A aba abre no Instagram; aqui a equipe escolhe a
 * rede e vê, sem rodeio, o que a API ligada hoje no painel permite e o que
 * não permite. Conta que o painel ainda não conecta (TikTok, LinkedIn...)
 * pode ser guardada à mão para a equipe e os agentes saberem que existe.
 */

export function SeletorDeRede({ valor, onEscolher, redes }: { valor: ChaveDaRede; onEscolher: (r: ChaveDaRede) => void; redes: PainelDoInstagram["redes"] | null }) {
  const temConta = (r: ChaveDaRede) => !!redes && (redes.conectadas.some((c) => c.rede === r) || redes.adicionadas.some((c) => c.rede === r));
  const visiveis = REDES_SOCIAIS.filter((r) => r.valor === "instagram" || r.valor === valor || temConta(r.valor));
  const outras = REDES_SOCIAIS.filter((r) => visiveis.indexOf(r) < 0);
  return (
    <div className="flex min-w-0 flex-wrap items-center" role="tablist" aria-label="Rede social">
      {visiveis.map((r) => (
        <button
          key={r.valor}
          type="button"
          role="tab"
          aria-selected={valor === r.valor}
          onClick={() => onEscolher(r.valor)}
          className={juntar(
            "mb-1 mr-1 inline-flex h-8 items-center rounded-full border px-3 text-[12.5px] transition-colors",
            valor === r.valor ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {r.rotulo}
          {temConta(r.valor) && r.valor !== "instagram" && <Check className="ml-1 h-3 w-3 text-success" aria-hidden="true" />}
        </button>
      ))}
      {outras.length > 0 && (
        <select
          className={juntar(campo, "mb-1 h-8 w-auto rounded-full px-3 text-[12.5px]")}
          value=""
          onChange={(e) => e.target.value && onEscolher(e.target.value as ChaveDaRede)}
          aria-label="Adicionar outra rede"
        >
          <option value="">+ Rede</option>
          {outras.map((r) => (
            <option key={r.valor} value={r.valor}>
              {r.rotulo}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default function OutrasRedes({ rede, painel, onMudou }: { rede: ChaveDaRede; painel: PainelDoInstagram | null; onMudou: () => void }) {
  const { clientId } = useMesa();
  const info = redePorChave(rede);
  const [endereco, setEndereco] = useState("");
  const [gravando, setGravando] = useState(false);
  const conectadas = painel ? painel.redes.conectadas.filter((c) => c.rede === rede) : [];
  const adicionadas = painel ? painel.redes.adicionadas.filter((c) => c.rede === rede) : [];

  const adicionar = async () => {
    const e = enderecoDaRede(endereco);
    if (!e) return;
    setGravando(true);
    try {
      await chamarInstagram("adicionar_rede", clientId, { rede, endereco: e });
      setEndereco("");
      toast.success(`${info.rotulo} guardado`);
      onMudou();
    } catch (err) {
      toast.error("Não foi possível guardar", { description: textoDoErro(err) });
    } finally {
      setGravando(false);
    }
  };
  const arquivar = async (id: string) => {
    try {
      await chamarInstagram("arquivar_rede", clientId, { rede_id: id });
      onMudou();
    } catch (err) {
      toast.error("Não foi possível arquivar", { description: textoDoErro(err) });
    }
  };

  return (
    <div className="min-w-0 space-y-3" data-outra-rede={rede}>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
        <div className="min-w-0 rounded-md bg-success/5 px-3 py-2">
          <p className="text-[12.5px] font-medium text-foreground">O que dá para fazer hoje</p>
          <ul className="mt-1 space-y-0.5 text-[12.5px] leading-5 text-foreground">
            {info.permite.map((p) => (
              <li key={p} className="flex items-start">
                <Check className="mr-1.5 mt-1 h-3 w-3 shrink-0 text-success" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="min-w-0 rounded-md bg-muted/50 px-3 py-2">
          <p className="text-[12.5px] font-medium text-foreground">O que a API não faz (ou o painel ainda não faz)</p>
          <ul className="mt-1 space-y-0.5 text-[12.5px] leading-5 text-foreground">
            {info.naoPermite.map((p) => (
              <li key={p} className="flex items-start">
                <X className="mr-1.5 mt-1 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <a href={info.fonte} target="_blank" rel="noreferrer" className="inline-flex items-center text-[12px] text-muted-foreground hover:text-foreground">
        <ExternalLink className="mr-1 h-3 w-3" aria-hidden="true" />
        Documentação oficial
      </a>

      <div className="min-w-0">
        <p className={texto.rotulo}>Contas de {info.rotulo} do cliente</p>
        {conectadas.length === 0 && adicionadas.length === 0 && <p className={juntar(texto.auxiliar, "mt-1")}>Nenhuma ainda.</p>}
        <ul className="mt-1 space-y-1">
          {conectadas.map((c, i) => (
            <li key={`c-${i}`} className="flex min-w-0 items-center text-[12.5px]">
              <span className="min-w-0 truncate">{c.endereco || "Conta conectada"}</span>
              <span className={juntar(etiqueta, "ml-2 bg-success/15 text-success")}>conectada</span>
            </li>
          ))}
          {adicionadas.map((c) => (
            <li key={c.id} className="flex min-w-0 items-center text-[12.5px]">
              <span className="min-w-0 truncate">{c.endereco}</span>
              <span className={juntar(etiqueta, "ml-2 bg-secondary text-muted-foreground")}>guardada à mão</span>
              <button type="button" className={juntar(botao.icone, "ml-1 h-7 w-7")} onClick={() => void arquivar(c.id)} aria-label={`Arquivar ${c.endereco}`}>
                <Archive className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex min-w-0 items-center">
          <input
            className={juntar(campo, "h-8 min-w-0 max-w-[280px] flex-1")}
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void adicionar();
            }}
            placeholder={rede === "google" || rede === "linkedin" || rede === "youtube" ? "Link da conta" : "@ da conta"}
            aria-label={`@ ou link da conta de ${info.rotulo}`}
          />
          <button type="button" className={juntar(botao.secundario, "ml-1.5 h-8 px-2.5 text-[12px]")} onClick={() => void adicionar()} disabled={!endereco.trim() || gravando}>
            {gravando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
            Adicionar
          </button>
        </div>
        {info.conectaHoje && (
          <p className={juntar(texto.auxiliar, "mt-2 leading-5")}>
            A conexão de verdade é pelo login da Meta, em{" "}
            <Link to="/config" className="text-primary hover:underline">
              Integrações
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
