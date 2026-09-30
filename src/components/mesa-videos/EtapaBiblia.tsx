import { useState } from "react";
import { ExternalLink, Loader2, Plus, Rotate3d, Save, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { useProjetoDoDiretor } from "@/lib/mesa-videos/api";
import { conferirContinuidade, type Biblia, type CenarioDaBiblia, type PersonagemDaBiblia, type ProjetoDoDiretor } from "../../../supabase/functions/mesa-videos/modulos/diretor-de-video";
import { EscolherImagem } from "./PecasDoGerador";
import type { IrPara } from "./MesaDeVideo";
import { chamarMesaVideos } from "./videosApi";

/**
 * Bíblia do projeto (frente V-A): personagens com folha de referência,
 * cenários com quadro âncora, paleta, lente, luz, clima e as regras de
 * continuidade. Fatos só com fonte (da pesquisa do diretor) ou do cliente.
 * Tudo fica no navegador na hora e vai ao banco em Salvar (SQL V-01).
 */

export async function salvarProjetoNoBanco(clientId: string, projeto: ProjetoDoDiretor): Promise<ProjetoDoDiretor | null> {
  try {
    const r = await chamarMesaVideos<{ projeto: ProjetoDoDiretor }>({ acao: "diretor_salvar", client_id: clientId, projeto, versao_lida: projeto.versao });
    return r.projeto;
  } catch (e) {
    toast.error("Não foi possível salvar no banco", { description: textoDoErro(e), duration: 9000 });
    return null;
  }
}

export default function EtapaBiblia({ irPara }: { irPara: IrPara }) {
  const { clientId } = useMesa();
  const { projeto, mudar, trocar, desfazer, podeDesfazer } = useProjetoDoDiretor(clientId);
  const [salvando, setSalvando] = useState(false);
  const b = projeto.biblia;
  const mudarBiblia = (m: Partial<Biblia>) => mudar((p) => ({ ...p, biblia: { ...p.biblia, ...m } }));
  const mudarPersonagem = (id: string, m: Partial<PersonagemDaBiblia>) => mudarBiblia({ personagens: b.personagens.map((x) => (x.id === id ? { ...x, ...m } : x)) });
  const mudarCenario = (id: string, m: Partial<CenarioDaBiblia>) => mudarBiblia({ cenarios: b.cenarios.map((x) => (x.id === id ? { ...x, ...m } : x)) });
  const proximoId = (prefixo: string, ids: string[]) => {
    let n = ids.length + 1;
    while (ids.indexOf(`${prefixo}${n}`) >= 0) n++;
    return `${prefixo}${n}`;
  };
  const avisos = conferirContinuidade(b, projeto.roteiro).filter((a) => a.ref === null);

  const salvar = async () => {
    setSalvando(true);
    const novo = await salvarProjetoNoBanco(clientId, projeto);
    if (novo) {
      trocar(novo);
      toast.success("Bíblia salva");
    }
    setSalvando(false);
  };

  return (
    <div className="min-w-0 space-y-6 pb-6">
      <Secao
        titulo="Bíblia"
        descricao={`${b.personagens.length} personagens · ${b.cenarios.length} cenários · ${b.fatos.length} fatos com fonte`}
        ajuda="A bíblia é o que não muda entre os planos: quem aparece (aparência e roupa copiadas iguais em todo prompt), onde (quadro âncora), a luz, a lente e as regras. O diretor preenche e a equipe ajusta. Pessoa real só com autorização registrada."
        acao={
          <>
            {podeDesfazer && (
              <button type="button" className={botao.icone} onClick={() => desfazer()} aria-label="Desfazer a última troca" title="Desfazer">
                <Undo2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button type="button" className={juntar(botao.secundario, "ml-1")} onClick={() => void salvar()} disabled={salvando} aria-label="Salvar no banco">
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <Save className="h-3.5 w-3.5 sm:mr-1.5" />}
              <span className="hidden sm:inline">Salvar</span>
            </button>
            <button type="button" className={juntar(botao.primario, "ml-1")} onClick={() => irPara("roteiro")}>
              Roteiro
            </button>
          </>
        }
        data-biblia=""
      >
        <GrupoDeCampos>
          <CampoDeFormulario rotulo="Título">
            <input className={campo} value={projeto.titulo} maxLength={120} onChange={(e) => mudar((p) => ({ ...p, titulo: e.target.value }))} />
          </CampoDeFormulario>
          <div className="min-w-0">
            <p className={juntar(texto.rotulo, "mb-1.5")}>Formato</p>
            <SeletorCompacto rotulo="Formato" larguraTotal opcoes={["9:16", "4:5", "1:1", "16:9"].map((f) => ({ valor: f, rotulo: f }))} valor={b.formato} onEscolher={(v) => mudarBiblia({ formato: v })} />
          </div>
          <CampoDeFormulario rotulo="Objetivo" largo>
            <input className={campo} value={b.objetivo} maxLength={300} onChange={(e) => mudarBiblia({ objetivo: e.target.value })} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Lente">
            <input className={campo} value={b.estilo.lente} maxLength={80} placeholder="35mm anamórfica" onChange={(e) => mudarBiblia({ estilo: { ...b.estilo, lente: e.target.value } })} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Luz">
            <input className={campo} value={b.estilo.luz} maxLength={160} placeholder="luz natural da manhã, suave" onChange={(e) => mudarBiblia({ estilo: { ...b.estilo, luz: e.target.value } })} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Clima">
            <input className={campo} value={b.estilo.clima} maxLength={120} onChange={(e) => mudarBiblia({ estilo: { ...b.estilo, clima: e.target.value } })} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Paleta" apoio="Cores separadas por vírgula.">
            <input className={campo} value={b.estilo.paleta.join(", ")} onChange={(e) => mudarBiblia({ estilo: { ...b.estilo, paleta: e.target.value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 8) } })} />
          </CampoDeFormulario>
        </GrupoDeCampos>
        {avisos.length > 0 && (
          <ul className="mt-3 space-y-1" aria-label="Avisos de continuidade">
            {avisos.map((a) => (
              <li key={a.texto} className={juntar(texto.auxiliar, a.nivel === "erro" ? "text-destructive" : "")}>
                {a.texto}
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao
        divisoria
        titulo="Personagens"
        descricao={`${b.personagens.filter((p) => p.folha_path).length} de ${b.personagens.length} com folha`}
        recolher={`mesa-videos:biblia:personagens:${clientId}`}
        resumo={`${b.personagens.length} ${b.personagens.length === 1 ? "personagem" : "personagens"}`}
        ajuda="Folha de referência: a mesma pessoa de frente, 3/4 e perfil. Gere os ângulos a partir de uma foto na ferramenta de ângulo e escolha a melhor como folha."
        acao={
          <>
            <button type="button" className={botao.discreto} onClick={() => irPara("gerar", { modo: "angulo" })} aria-label="Gerar ângulos para a folha">
              <Rotate3d className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Ângulos</span>
            </button>
            <button type="button" className={juntar(botao.secundario, "ml-1")} onClick={() => mudarBiblia({ personagens: b.personagens.concat([{ id: proximoId("pe", b.personagens.map((x) => x.id)), nome: "Personagem", aparencia: "", roupa: "", folha_path: null, pessoa_real: false, autorizado: false }]) })} aria-label="Novo personagem">
              <Plus className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Novo</span>
            </button>
          </>
        }
      >
        {b.personagens.length ? (
          <ul className="divide-y divide-border" aria-label="Personagens">
            {b.personagens.map((p) => (
              <li key={p.id} className="py-3" data-personagem={p.id}>
                <GrupoDeCampos colunas={3}>
                  <CampoDeFormulario rotulo={`Nome (${p.id})`}>
                    <input className={campo} value={p.nome} maxLength={80} onChange={(e) => mudarPersonagem(p.id, { nome: e.target.value })} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Aparência (fixa)">
                    <input className={campo} value={p.aparencia} maxLength={400} onChange={(e) => mudarPersonagem(p.id, { aparencia: e.target.value })} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Roupa">
                    <input className={campo} value={p.roupa} maxLength={240} onChange={(e) => mudarPersonagem(p.id, { roupa: e.target.value })} />
                  </CampoDeFormulario>
                  <EscolherImagem rotulo="Folha de referência" valor={p.folha_path} onEscolher={(c) => mudarPersonagem(p.id, { folha_path: c })} />
                  <div className="min-w-0 space-y-1 self-center text-[13px]">
                    <label className="flex items-center">
                      <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={p.pessoa_real} onChange={(e) => mudarPersonagem(p.id, { pessoa_real: e.target.checked, autorizado: e.target.checked ? p.autorizado : false })} />
                      Pessoa real
                    </label>
                    {p.pessoa_real && (
                      <label className="flex items-center">
                        <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={p.autorizado} onChange={(e) => mudarPersonagem(p.id, { autorizado: e.target.checked })} />
                        Autorização de imagem registrada
                      </label>
                    )}
                  </div>
                  <div className="flex items-center justify-end self-center">
                    <button type="button" className={botao.icone} onClick={() => mudarBiblia({ personagens: b.personagens.filter((x) => x.id !== p.id) })} aria-label={`Tirar ${p.nome}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </GrupoDeCampos>
              </li>
            ))}
          </ul>
        ) : (
          <EstadoVazio compacto titulo="Sem personagem." descricao="Vídeo sem gente (produto, ambiente) também serve." />
        )}
      </Secao>

      <Secao
        divisoria
        titulo="Cenários"
        descricao={`${b.cenarios.filter((c) => c.ancora_path).length} de ${b.cenarios.length} com quadro âncora`}
        recolher={`mesa-videos:biblia:cenarios:${clientId}`}
        resumo={`${b.cenarios.length} ${b.cenarios.length === 1 ? "cenário" : "cenários"}`}
        ajuda="Quadro âncora: a imagem do lugar de onde os planos partem (foto real do cliente ou gerada). Mesma hora do dia em todos os planos do cenário."
        acao={
          <button type="button" className={botao.secundario} onClick={() => mudarBiblia({ cenarios: b.cenarios.concat([{ id: proximoId("ce", b.cenarios.map((x) => x.id)), nome: "Cenário", descricao: "", ancora_path: null, hora: "" }]) })} aria-label="Novo cenário">
            <Plus className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Novo</span>
          </button>
        }
      >
        {b.cenarios.length ? (
          <ul className="divide-y divide-border" aria-label="Cenários">
            {b.cenarios.map((c) => (
              <li key={c.id} className="py-3" data-cenario={c.id}>
                <GrupoDeCampos colunas={3}>
                  <CampoDeFormulario rotulo={`Nome (${c.id})`}>
                    <input className={campo} value={c.nome} maxLength={80} onChange={(e) => mudarCenario(c.id, { nome: e.target.value })} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Descrição">
                    <input className={campo} value={c.descricao} maxLength={400} onChange={(e) => mudarCenario(c.id, { descricao: e.target.value })} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Hora e luz">
                    <input className={campo} value={c.hora} maxLength={80} onChange={(e) => mudarCenario(c.id, { hora: e.target.value })} />
                  </CampoDeFormulario>
                  <EscolherImagem rotulo="Quadro âncora" valor={c.ancora_path} onEscolher={(x) => mudarCenario(c.id, { ancora_path: x })} />
                  <div />
                  <div className="flex items-center justify-end self-center">
                    <button type="button" className={botao.icone} onClick={() => mudarBiblia({ cenarios: b.cenarios.filter((x) => x.id !== c.id) })} aria-label={`Tirar ${c.nome}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </GrupoDeCampos>
              </li>
            ))}
          </ul>
        ) : (
          <EstadoVazio compacto titulo="Sem cenário." />
        )}
      </Secao>

      <Secao
        divisoria
        titulo="Regras e fatos"
        descricao={`${b.regras.length} regras · ${b.perguntas.length} perguntas abertas`}
        ajuda="Regras de continuidade valem para todos os planos. Fato só entra com fonte; o que o diretor não achou vira pergunta."
        recolher={`mesa-videos:biblia:regras:${clientId}`}
        resumo={`${b.regras.length} regras · ${b.fatos.length} fatos`}
      >
        <CampoDeFormulario rotulo="Regras (uma por linha)" largo>
          <textarea className={juntar(campoTexto, "min-h-[96px]")} value={b.regras.join("\n")} onChange={(e) => mudarBiblia({ regras: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 20) })} />
        </CampoDeFormulario>
        {b.perguntas.length > 0 && (
          <div className="mt-4">
            <p className={juntar(texto.rotulo, "mb-1")}>Perguntas abertas</p>
            <ul className="space-y-1">
              {b.perguntas.map((q) => (
                <li key={q} className={texto.corpo}>
                  {q}
                </li>
              ))}
            </ul>
          </div>
        )}
        {b.fatos.length > 0 && (
          <div className="mt-4">
            <p className={juntar(texto.rotulo, "mb-1")}>Fatos com fonte</p>
            <ul className="divide-y divide-border">
              {b.fatos.map((f) => {
                const fonte = b.fontes.find((x) => x.id === f.fonte);
                return (
                  <li key={f.texto} className="flex min-w-0 items-baseline py-1.5">
                    <span className={juntar(texto.corpo, "mr-2 min-w-0 flex-1")}>{f.texto}</span>
                    {fonte ? (
                      <a href={fonte.url} target="_blank" rel="noopener noreferrer" className={juntar(texto.auxiliar, "inline-flex shrink-0 items-center hover:text-foreground")} title={fonte.titulo}>
                        {fonte.id}
                        <ExternalLink className="ml-1 h-3 w-3" />
                      </a>
                    ) : (
                      <span className={texto.auxiliar}>cliente</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Secao>
    </div>
  );
}
