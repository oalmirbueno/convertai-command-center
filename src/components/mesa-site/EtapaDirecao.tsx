import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { GradeDeGrupos, GrupoDeFuncoes } from "@/components/sistema/GrupoDeFuncoes";
import { botao, campoTexto, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { ATRIBUTOS_DO_DNA, MAX_ATRIBUTOS, MIN_ATRIBUTOS, MOVIMENTOS, NICHOS, NIVEIS, SECOES_DO_SITE, SECOES_PADRAO } from "../../../supabase/functions/_shared/site-metodo";
import { chamarSite, type LinhaDoSite, useGuardarSite } from "./siteApi";
import SeletorDoMotor from "./SeletorDoMotor";

/**
 * Etapa 3: direção. Nicho, DNA (3 a 5 atributos), movimento, referência de
 * nível, seções na ordem e o modelo do motor de código deste site. A paleta
 * vem do kit da marca (Contexto), nunca de um estilo pronto.
 */
export default function EtapaDirecao({ site, onIrPara }: { site: LinhaDoSite; onIrPara: (etapa: string) => void }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const dnaSalvo = site.dna && Array.isArray(site.dna.atributos) ? site.dna : null;
  const [atributos, setAtributos] = useState<string[]>([]);
  const [movimento, setMovimento] = useState("sutil");
  const [nivel, setNivel] = useState("saas");
  const [nicho, setNicho] = useState("servico_local");
  const [secoes, setSecoes] = useState<string[]>(SECOES_PADRAO.slice());
  const [observacao, setObservacao] = useState("");
  const [modelo, setModelo] = useState<string>("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setAtributos(dnaSalvo ? dnaSalvo.atributos.map((a: { id: string }) => a.id) : []);
    setMovimento((dnaSalvo && dnaSalvo.movimento) || "sutil");
    setNivel((dnaSalvo && dnaSalvo.nivel) || "saas");
    setNicho((dnaSalvo && dnaSalvo.nicho) || site.direcao.nicho || "servico_local");
    setSecoes(Array.isArray(site.direcao.secoes) && site.direcao.secoes.length ? site.direcao.secoes : SECOES_PADRAO.slice());
    setObservacao(site.direcao.observacao || "");
    setModelo(site.modelo || "");
    // Só ao abrir outro site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

  const alternar = (id: string) => setAtributos((l) => (l.indexOf(id) >= 0 ? l.filter((x) => x !== id) : l.length >= MAX_ATRIBUTOS ? l : l.concat([id])));
  const alternarSecao = (id: string) => setSecoes((l) => (l.indexOf(id) >= 0 ? l.filter((x) => x !== id) : SECOES_DO_SITE.map((s) => s.id).filter((s) => s === id || l.indexOf(s) >= 0)));

  const salvar = async (seguir: boolean) => {
    setSalvando(true);
    try {
      const d = await chamarSite<{ site: LinhaDoSite }>("site_salvar", {
        site_id: site.id,
        dna: { atributos, movimento, nivel, nicho },
        direcao: { nicho, nivel, secoes, observacao, peca: "site de uma página" },
        modelo,
        etapa: seguir ? "conteudo" : undefined,
      });
      guardar(d.site);
      if (seguir) onIrPara("conteudo");
    } catch (e) {
      avisarErro(e, "A direção não foi salva");
    } finally {
      setSalvando(false);
    }
  };

  const poucos = atributos.length < MIN_ATRIBUTOS;

  return (
    <div className="min-w-0 space-y-6" data-etapa-direcao="">
      <Secao
        titulo="Direção"
        descricao={`${atributos.length} de ${MIN_ATRIBUTOS} a ${MAX_ATRIBUTOS} atributos`}
        ajuda="A fórmula de 6 blocos: o quê, estrutura, estilo e DNA, movimento, stack e referência de nível. O DNA escolhe de 3 a 5 atributos; a paleta sai do kit da marca. O conselho de agentes entra aqui quando a frente do conselho estiver no painel."
        acao={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={salvando} onClick={() => void salvar(false)}>
              {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Salvar
            </button>
            <button type="button" className={botao.primario} disabled={salvando || poucos} onClick={() => void salvar(true)} title={poucos ? "Escolha ao menos 3 atributos" : undefined}>
              Seguir
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </>
        }
      >
        <GradeDeGrupos colunas={3}>
          <GrupoDeFuncoes titulo="Nicho">
            <SeletorCompacto rotulo="Nicho" opcoes={NICHOS.map((n) => ({ valor: n.id, rotulo: n.rotulo }))} valor={nicho} onEscolher={setNicho} larguraTotal />
          </GrupoDeFuncoes>
          <GrupoDeFuncoes titulo="Movimento">
            <SeletorCompacto rotulo="Movimento" opcoes={MOVIMENTOS.map((m) => ({ valor: m.id, rotulo: m.rotulo, descricao: m.descricao }))} valor={movimento} onEscolher={setMovimento} larguraTotal />
          </GrupoDeFuncoes>
          <GrupoDeFuncoes titulo="Referência de nível">
            <SeletorCompacto rotulo="Referência de nível" opcoes={NIVEIS.map((n) => ({ valor: n.id, rotulo: n.rotulo, descricao: n.descricao }))} valor={nivel} onEscolher={setNivel} larguraTotal />
          </GrupoDeFuncoes>
        </GradeDeGrupos>
      </Secao>

      <Secao titulo="DNA" descricao={dnaSalvo && dnaSalvo.fonte === "jev" ? "Sugerido pelas referências" : undefined} recolher="mesa-site:direcao:dna">
        <div className="flex flex-wrap" role="group" aria-label="Atributos do DNA">
          {ATRIBUTOS_DO_DNA.map((a) => {
            const ligado = atributos.indexOf(a.id) >= 0;
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={ligado}
                title={a.descricao}
                onClick={() => alternar(a.id)}
                className={juntar(etiqueta, "mb-2 mr-2 h-7 px-2.5 text-[12px]", ligado ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70")}
              >
                {a.rotulo}
              </button>
            );
          })}
        </div>
        {dnaSalvo && Array.isArray(dnaSalvo.cores_das_referencias) && dnaSalvo.cores_das_referencias.length > 0 && (
          <div className="flex min-w-0 items-center">
            <span className={juntar(texto.auxiliar, "mr-2")}>Cores das referências</span>
            {dnaSalvo.cores_das_referencias.slice(0, 8).map((c: string) => (
              <span key={c} className="mr-1 inline-block h-4 w-4 rounded-sm border border-border" style={{ background: c }} title={c} />
            ))}
          </div>
        )}
      </Secao>

      <Secao titulo="Seções" descricao={`${secoes.length} na página`} recolher="mesa-site:direcao:secoes">
        <div className="grid min-w-0 grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-5">
          {SECOES_DO_SITE.map((s) => (
            <label key={s.id} className="flex min-w-0 cursor-pointer items-center py-1 text-[13px]">
              <input type="checkbox" className="mr-2 shrink-0" checked={secoes.indexOf(s.id) >= 0} onChange={() => alternarSecao(s.id)} />
              <span className="truncate">{s.rotulo}</span>
            </label>
          ))}
        </div>
      </Secao>

      <Secao titulo="Motor e observação" recolher="mesa-site:direcao:motor">
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          <SeletorDoMotor valor={modelo} onChange={setModelo} />
          <label className="block min-w-0">
            <span className={juntar(texto.rotulo, "mb-1 block")}>Observação para o site</span>
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} maxLength={1500} className={juntar(campoTexto, "min-h-[76px]")} placeholder="Ex.: CTA para o WhatsApp; evitar fundo branco puro" />
          </label>
        </div>
      </Secao>
    </div>
  );
}
