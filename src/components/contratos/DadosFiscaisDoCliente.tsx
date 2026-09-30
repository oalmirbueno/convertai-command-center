import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, Search } from "lucide-react";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarContratos, CHAVES_DOS_CONTRATOS, type RespostaDaFicha } from "@/lib/contratos/api";
import {
  CAMPOS_DA_FICHA,
  documentoInvalido,
  faltasNaFicha,
  type FichaFiscal,
  fichaVazia,
  lerFicha,
  mesclarFicha,
  OPCOES_DE_PESSOA,
  soDigitos,
} from "../../../supabase/functions/_shared/contrato-ficha";
import { formatarDocumento, type Valores } from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * Ficha fiscal do cliente (frente CON2, 30/09): CNPJ ou CPF, razão social,
 * endereço, representante e e-mails de contrato e de cobrança. Com o CNPJ, a
 * consulta pública (BrasilAPI) roda no servidor e completa só o que está
 * vazio; a pessoa confere e salva. Todo contrato do cliente reaproveita.
 * Aparece na ficha do cliente (Cadastro) e no contrato (Dados).
 */
export default function DadosFiscaisDoCliente({ clientId, editavel = true, aoSalvar }: { clientId: string; editavel?: boolean; aoSalvar?: (ficha: FichaFiscal, valores: Valores) => void }) {
  const qc = useQueryClient();
  const consulta = useQuery({ queryKey: CHAVES_DOS_CONTRATOS.ficha(clientId), queryFn: () => chamarContratos<RespostaDaFicha>("ficha_ler", { client_id: clientId }) });
  const [ficha, setFicha] = useState<FichaFiscal>(fichaVazia());
  const [consultando, setConsultando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [daReceita, setDaReceita] = useState(false);
  const d = consulta.data;
  useEffect(() => {
    if (!d) return;
    setFicha(lerFicha(d.existe ? d.ficha : d.sugestao || d.ficha));
    setAvisos([]);
    setDaReceita(false);
  }, [d]);

  if (consulta.isLoading) return <Carregando forma="lista" linhas={3} rotulo="Lendo a ficha fiscal" />;
  if (consulta.isError || !d) {
    return (
      <EstadoDeErro
        titulo={textoDoErro(consulta.error, "A ficha fiscal não abriu.")}
        acao={
          <button type="button" className={botao.secundario} onClick={() => consulta.refetch()}>
            Tentar de novo
          </button>
        }
      />
    );
  }

  const mudar = (k: keyof FichaFiscal, v: string) => setFicha((f) => ({ ...f, [k]: v }));
  const original = lerFicha(d.existe ? d.ficha : fichaVazia());
  const mudou = (Object.keys(ficha) as Array<keyof FichaFiscal>).some((k) => String(ficha[k] || "") !== String(original[k] || ""));
  const faltas = faltasNaFicha(lerFicha(ficha));
  const erroDoc = documentoInvalido(ficha.documento);
  const cnpj = soDigitos(ficha.documento);

  const consultar = async () => {
    setConsultando(true);
    try {
      const r = await chamarContratos<RespostaDaFicha>("cnpj_consultar", { cnpj });
      const { ficha: junta, mudaram } = mesclarFicha(lerFicha(ficha), r.ficha, false);
      setFicha({ ...junta, situacao_cadastral: r.ficha.situacao_cadastral });
      setAvisos(r.avisos || []);
      setDaReceita(true);
      toast.success(mudaram.length ? `${mudaram.length} campos completados pela Receita` : "A Receita não trouxe nada novo", { description: "Confira e salve. Nada foi gravado ainda." });
    } catch (e) {
      toast.error("A consulta do CNPJ não saiu", { description: textoDoErro(e) });
    } finally {
      setConsultando(false);
    }
  };

  const gravar = async (f: FichaFiscal, fonte: "manual" | "brasilapi") => chamarContratos<RespostaDaFicha & { valores: Valores }>("ficha_salvar", { client_id: clientId, ficha: f, fonte });

  const salvar = async () => {
    setSalvando(true);
    try {
      const r = await gravar(lerFicha(ficha), daReceita ? "brasilapi" : "manual");
      qc.setQueryData(CHAVES_DOS_CONTRATOS.ficha(clientId), { ...d, ficha: r.ficha, existe: true, faltas: r.faltas, valores: r.valores, sugestao: null });
      if (aoSalvar) aoSalvar(r.ficha, r.valores || {});
      const anterior = r.anterior || null;
      toast.success("Ficha fiscal salva", {
        description: "Os próximos contratos já nascem com estes dados.",
        action: {
          label: "Desfazer",
          onClick: () => {
            void gravar(anterior || fichaVazia(), "manual")
              .then(() => qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.ficha(clientId) }))
              .catch((e) => toast.error("Não foi desfeito", { description: textoDoErro(e) }));
          },
        },
      });
    } catch (e) {
      toast.error("A ficha não foi salva", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4" data-ficha-fiscal="">
      <div className="flex min-w-0 flex-wrap items-end [&>*]:mb-1 [&>*]:mr-2">
        <CampoDeFormulario rotulo="CNPJ ou CPF" erro={erroDoc || undefined} className="min-w-[200px] flex-1">
          <input
            value={ficha.documento.length === 14 || ficha.documento.length === 11 ? formatarDocumento(ficha.documento) : ficha.documento}
            onChange={(e) => mudar("documento", soDigitos(e.target.value).slice(0, 14))}
            disabled={!editavel}
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
            className={campo}
          />
        </CampoDeFormulario>
        {editavel && (
          <button type="button" className={botao.secundario} onClick={() => void consultar()} disabled={consultando || cnpj.length !== 14 || !!erroDoc}>
            {consultando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Consultar CNPJ
          </button>
        )}
      </div>
      {!d.existe && d.sugestao && <p className={texto.auxiliar}>Sugestão do cadastro. Confira e salve.</p>}
      {ficha.situacao_cadastral && ficha.situacao_cadastral !== "ATIVA" && <p className={juntar(texto.auxiliar, "text-warning")}>Situação na Receita: {ficha.situacao_cadastral}.</p>}
      {avisos.map((a) => (
        <p key={a} className={juntar(texto.auxiliar, "text-warning")}>
          {a}
        </p>
      ))}
      <GrupoDeCampos colunas={2}>
        {CAMPOS_DA_FICHA.filter((c) => c.campo !== "documento").map((c) => (
          <CampoDeFormulario key={c.campo} rotulo={c.rotulo}>
            {c.tipo === "escolha" ? (
              <select value={ficha.tipo_pessoa} onChange={(e) => mudar("tipo_pessoa", e.target.value)} disabled={!editavel} className={campo}>
                <option value="">Escolha</option>
                {OPCOES_DE_PESSOA.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={String(ficha[c.campo] || "")}
                onChange={(e) => mudar(c.campo, c.tipo === "documento" ? soDigitos(e.target.value).slice(0, 11) : e.target.value)}
                disabled={!editavel}
                type={c.tipo === "email" ? "email" : "text"}
                inputMode={c.tipo === "documento" || c.campo === "cep" ? "numeric" : undefined}
                className={campo}
              />
            )}
          </CampoDeFormulario>
        ))}
      </GrupoDeCampos>
      <div className="flex min-w-0 items-center">
        <p className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate", faltas.length ? "text-warning" : "")}>{faltas.length ? `Falta: ${faltas.join(", ")}` : "Completa para contrato"}</p>
        {editavel && (
          <button type="button" className={juntar(botao.primario, "ml-2")} onClick={() => void salvar()} disabled={salvando || !mudou || !!erroDoc}>
            {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Salvar ficha
          </button>
        )}
      </div>
    </div>
  );
}
