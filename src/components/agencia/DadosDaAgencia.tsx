import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { CampoDeFormulario, EstadoDeErro, GrupoDeCampos, Secao, botao, campo, campoTexto, espaco, juntar, texto } from "@/components/sistema";
import {
  CAMPOS_DA_AGENCIA,
  CHAVE_DOS_DADOS_DA_AGENCIA,
  OBRIGATORIOS_POR_TIPO,
  UFS,
  enviarLogoDaAgencia,
  faltasNosDados,
  lerDadosDaAgenciaNaTela,
  lerSugestoesDaAgencia,
  normalizarDadosDaAgencia,
  salvarDadosDaAgencia,
  situacaoDoCampo,
  urlDaLogoDaAgencia,
  type CampoDaAgencia,
  type DadosDaAgencia as Dados,
  type DescricaoDoCampo,
  type SugestaoDaAgencia,
  type TipoDeDocumentoDaAgencia,
} from "@/lib/agencia/dadosDaAgencia";
import { textoDoErro } from "@/lib/mesa/api";

/**
 * Configurações, Dados da agência (frente BAS, 29/09). Quem é a contratada nos
 * contratos, quem assina a proposta e o que vai no cabeçalho dos documentos.
 * A equipe vê; só o admin altera. Nada vem preenchido: o que o banco já prova
 * aparece como sugestão ao lado do campo vazio, e só entra se o admin usar.
 */

type Rascunho = Record<CampoDaAgencia, string>;

const GRUPOS: { grupo: DescricaoDoCampo["grupo"]; titulo: string }[] = [
  { grupo: "empresa", titulo: "Empresa" },
  { grupo: "endereco", titulo: "Endereço e foro" },
  { grupo: "representante", titulo: "Representante" },
  { grupo: "contato", titulo: "Contato" },
  { grupo: "pagamento", titulo: "Pagamento" },
];

const LONGOS: CampoDaAgencia[] = ["endereco", "dados_bancarios"];
const EXIGIDOS = new Set<CampoDaAgencia>(OBRIGATORIOS_POR_TIPO.contrato.concat(OBRIGATORIOS_POR_TIPO.proposta));

export const AJUDA_DOS_DADOS_DA_AGENCIA =
  "Contratos, propostas e documentos usam estes dados: a qualificação da contratada, o foro, o contato da capa e a logo. " +
  "Contrato e proposta não geram enquanto faltar o que cada um pede (marcado com *). " +
  "Nada vem preenchido: quando o painel já sabe algo, aparece como sugestão embaixo do campo. Só o admin altera.";

function paraRascunho(d: Dados): Rascunho {
  const r = {} as Rascunho;
  for (const c of CAMPOS_DA_AGENCIA) r[c.campo] = (d[c.campo] as string | null) || "";
  return r;
}

/** "Contrato: pronto · Proposta: falta 1" (estado, uma linha). */
export function estadoDosDados(d: Dados): string {
  const parte = (tipo: TipoDeDocumentoDaAgencia, nome: string) => {
    const n = faltasNosDados(d, tipo).length;
    return n === 0 ? `${nome}: pronto` : `${nome}: ${n === 1 ? "falta 1" : `faltam ${n}`}`;
  };
  return `${parte("contrato", "Contrato")} · ${parte("proposta", "Proposta")}`;
}

export default function DadosDaAgencia() {
  const { profile } = useAuth();
  const admin = profile?.role === "admin";
  const queryClient = useQueryClient();
  const dados = useQuery({ queryKey: CHAVE_DOS_DADOS_DA_AGENCIA, queryFn: lerDadosDaAgenciaNaTela });
  const sugestoes = useQuery({
    queryKey: ["agencia", "sugestoes"],
    queryFn: lerSugestoesDaAgencia,
    enabled: admin,
  });
  const logo = useQuery({
    queryKey: ["agencia", "logo", dados.data?.logo_path || ""],
    queryFn: () => urlDaLogoDaAgencia(dados.data as Dados),
    enabled: !!dados.data?.logo_path,
  });

  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [enviandoLogo, setEnviandoLogo] = useState(false);
  const arquivo = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (dados.data && rascunho === null) setRascunho(paraRascunho(dados.data));
  }, [dados.data, rascunho]);

  const salvo = dados.data || null;
  const atual = useMemo(() => (rascunho ? normalizarDadosDaAgencia({ ...(salvo || {}), ...rascunho }) : salvo), [rascunho, salvo]);
  const mudou = useMemo(() => {
    if (!rascunho || !salvo) return false;
    const n = normalizarDadosDaAgencia(rascunho);
    return CAMPOS_DA_AGENCIA.some((c) => c.campo !== "logo_path" && (n[c.campo] || null) !== (salvo[c.campo] || null));
  }, [rascunho, salvo]);

  const sugestaoDe = (c: CampoDaAgencia): SugestaoDaAgencia | null =>
    (sugestoes.data || []).find((s) => s.campo === c && !!s.valor) || null;

  const aplicar = (novo: Dados) => {
    queryClient.setQueryData(CHAVE_DOS_DADOS_DA_AGENCIA, novo);
    setRascunho(paraRascunho(novo));
  };

  const salvar = async () => {
    if (!rascunho) return;
    setSalvando(true);
    try {
      const { logo_path: _logo, ...campos } = rascunho;
      aplicar(await salvarDadosDaAgencia(campos));
      toast.success("Dados da agência salvos");
    } catch (e) {
      // O rascunho fica como está: nada do que foi digitado se perde.
      toast.error("Não foi possível salvar", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  const enviarLogo = async (f: File | null | undefined) => {
    if (!f) return;
    setEnviandoLogo(true);
    try {
      const novo = await enviarLogoDaAgencia(f);
      queryClient.setQueryData(CHAVE_DOS_DADOS_DA_AGENCIA, novo);
      setRascunho((r) => (r ? { ...r, logo_path: novo.logo_path || "" } : paraRascunho(novo)));
      toast.success("Logo enviada");
    } catch (e) {
      toast.error("Não foi possível enviar a logo", { description: textoDoErro(e) });
    } finally {
      setEnviandoLogo(false);
      if (arquivo.current) arquivo.current.value = "";
    }
  };

  const alterar = (c: CampoDaAgencia, v: string) => setRascunho((r) => (r ? { ...r, [c]: v } : r));

  const renderCampo = (d: DescricaoDoCampo) => {
    const valor = rascunho ? rascunho[d.campo] : "";
    const situacao = atual && valor.trim() ? situacaoDoCampo(atual, d.campo) : "ok";
    const sugestao = admin && !valor.trim() ? sugestaoDe(d.campo) : null;
    const apoio = sugestao ? (
      <button
        type="button"
        className="text-left text-primary underline-offset-2 hover:underline"
        title={sugestao.fonte}
        onClick={() => alterar(d.campo, sugestao.valor)}
      >
        Usar sugestão: {sugestao.valor}
      </button>
    ) : undefined;
    const comum = {
      value: valor,
      disabled: !admin || salvando,
      onChange: (e: { target: { value: string } }) => alterar(d.campo, e.target.value),
    };
    return (
      <CampoDeFormulario
        key={d.campo}
        rotulo={d.rotulo}
        obrigatorio={EXIGIDOS.has(d.campo)}
        largo={LONGOS.indexOf(d.campo) >= 0}
        apoio={apoio}
        erro={situacao === "invalido" ? `${d.rotulo} inválido` : undefined}
      >
        {d.campo === "uf" ? (
          <select className={campo} {...comum}>
            <option value="">-</option>
            {UFS.map((uf) => (
              <option key={uf} value={uf}>{uf}</option>
            ))}
          </select>
        ) : LONGOS.indexOf(d.campo) >= 0 ? (
          <textarea className={campoTexto} rows={3} {...comum} />
        ) : (
          <input className={campo} type={d.campo === "email" ? "email" : "text"} autoComplete="off" {...comum} />
        )}
      </CampoDeFormulario>
    );
  };

  return (
    <Secao
      titulo="Dados da agência"
      ajuda={AJUDA_DOS_DADOS_DA_AGENCIA}
      descricao={salvo ? estadoDosDados(salvo) : undefined}
      acao={
        admin ? (
          <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={!mudou || salvando}>
            {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Salvar
          </button>
        ) : undefined
      }
    >
      {dados.isLoading && (
        <p className={texto.auxiliar}>
          <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Lendo os dados da agência
        </p>
      )}
      {dados.isError && (
        <EstadoDeErro
          descricao={textoDoErro(dados.error)}
          acao={
            <button type="button" className={botao.secundario} onClick={() => void dados.refetch()}>
              Tentar de novo
            </button>
          }
        />
      )}
      {rascunho && (
        <div className="min-w-0 space-y-6">
          {!admin && <p className={texto.auxiliar}>Só o admin altera.</p>}
          {/* Largura total (frente CHV): grupos lado a lado no computador largo. */}
          <div className={juntar(espaco.colunas, "xl:grid-cols-2")}>
            {GRUPOS.map((g) => (
              <GrupoDeCampos key={g.grupo} titulo={g.titulo}>
                {CAMPOS_DA_AGENCIA.filter((c) => c.grupo === g.grupo).map(renderCampo)}
              </GrupoDeCampos>
            ))}
          </div>
          <div className="min-w-0">
            <p className={juntar(texto.rotulo, "mb-1.5")}>
              Logo<span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
            </p>
            <div className="flex min-w-0 flex-wrap items-center">
              {logo.data ? (
                <img src={logo.data} alt="Logo da agência" className="mr-3 h-12 max-w-[180px] object-contain" />
              ) : (
                <span className={juntar(texto.auxiliar, "mr-3")}>{salvo?.logo_path ? "Carregando a logo" : "Sem logo"}</span>
              )}
              {admin && (
                <>
                  <input
                    ref={arquivo}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    aria-label="Arquivo da logo"
                    onChange={(e) => void enviarLogo(e.target.files && e.target.files[0])}
                  />
                  <button type="button" className={botao.secundario} onClick={() => arquivo.current?.click()} disabled={enviandoLogo}>
                    {enviandoLogo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ImageUp className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                    {salvo?.logo_path ? "Trocar logo" : "Enviar logo"}
                  </button>
                </>
              )}
            </div>
            {logo.isError && <p className="mt-1.5 text-[12px] text-destructive">{textoDoErro(logo.error)}</p>}
          </div>
        </div>
      )}
    </Secao>
  );
}
