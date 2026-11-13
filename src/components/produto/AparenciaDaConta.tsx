import { useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ImagePlus, Moon, Sun, Trash2 } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { fraseDoErro, salvarConta, type EstadoDoProduto } from "@/lib/produto/api";
import { CORES_DA_EMPRESA, prepararLogo, type AparenciaDaEmpresa, type CorDaEmpresa } from "@/lib/produto/aparencia";
import { useRelerProduto } from "@/hooks/useProduto";
import { CampoDeFormulario, Secao, SeletorCompacto, botao, campo, foco, juntar, superficie, texto } from "@/components/sistema";

/**
 * Personalização da empresa: o logo e o nome que aparecem no topo e a cor de
 * destaque do produto para toda a equipe. O tema claro ou escuro é de cada
 * pessoa e fica guardado no aparelho dela.
 */
export default function AparenciaDaConta({ estado }: { estado: EstadoDoProduto }) {
  const conta = estado.conta!;
  const reler = useRelerProduto();
  const { theme, setTheme } = useTheme();
  const arquivo = useRef<HTMLInputElement | null>(null);
  const [cor, setCor] = useState<CorDaEmpresa>(conta.aparencia.cor || "verde");
  const [nome, setNome] = useState(conta.aparencia.nome_curto || "");
  const [logo, setLogo] = useState<string | null>(conta.aparencia.logo || null);
  const [salvando, setSalvando] = useState(false);

  const escolherLogo = async (f: File | undefined) => {
    if (!f) return;
    try {
      setLogo(await prepararLogo(f));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível usar essa imagem.");
    }
    if (arquivo.current) arquivo.current.value = "";
  };

  const salvar = async () => {
    const aparencia: AparenciaDaEmpresa = { cor, ...(nome.trim() ? { nome_curto: nome.trim() } : {}), ...(logo ? { logo } : {}) };
    setSalvando(true);
    try {
      await salvarConta({ aparencia });
      await reler();
      toast.success("Aparência salva para toda a equipe.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível salvar a aparência."));
    } finally {
      setSalvando(false);
    }
  };

  const mudou = cor !== (conta.aparencia.cor || "verde") || nome.trim() !== (conta.aparencia.nome_curto || "") || (logo || "") !== (conta.aparencia.logo || "");

  return (
    <div className="grid min-w-0 grid-cols-1 items-start gap-x-10 gap-y-6 xl:grid-cols-[minmax(0,1fr)_340px]" data-aparencia-da-conta="">
      <Secao
        titulo="Aparência"
        ajuda="O logo, o nome e a cor valem para todo mundo da empresa. O tema claro ou escuro é escolha de cada pessoa e fica guardado no aparelho dela."
        acao={
          <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando || !mudou} data-salvar-aparencia="">
            {salvando ? "Salvando..." : "Salvar"}
          </button>
        }
      >
        <div className="min-w-0 space-y-6">
          <CampoDeFormulario rotulo="Logo da empresa" apoio="PNG com fundo transparente fica melhor nos dois temas">
            <div className="flex min-w-0 flex-wrap items-center">
              <span className={juntar(superficie.painel, "mr-3 flex h-14 w-[168px] shrink-0 items-center justify-center px-3")}>
                {logo ? <img src={logo} alt="Logo da empresa" className="max-h-9 max-w-full object-contain" data-previa-do-logo="" /> : <span className={texto.auxiliar}>Sem logo</span>}
              </span>
              <input ref={arquivo} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" aria-label="Escolher o logo" onChange={(e) => void escolherLogo(e.target.files ? e.target.files[0] : undefined)} />
              <button type="button" className={botao.secundario} onClick={() => arquivo.current && arquivo.current.click()}>
                <ImagePlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {logo ? "Trocar" : "Enviar logo"}
              </button>
              {logo && (
                <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => setLogo(null)} aria-label="Tirar o logo" title="Tirar o logo">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>
          </CampoDeFormulario>

          <CampoDeFormulario rotulo="Nome no topo" apoio="Vazio usa o nome da empresa. Com logo, o nome não aparece">
            <input value={nome} onChange={(e) => setNome(e.target.value)} className={juntar(campo, "max-w-[360px]")} maxLength={40} placeholder={conta.nome} />
          </CampoDeFormulario>

          <CampoDeFormulario rotulo="Cor de destaque">
            <div className="flex min-w-0 flex-wrap" role="radiogroup" aria-label="Cor de destaque">
              {CORES_DA_EMPRESA.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={cor === c.id}
                  aria-label={c.nome}
                  title={c.nome}
                  onClick={() => setCor(c.id)}
                  data-cor={c.id}
                  className={juntar("toque-compacto mb-2 mr-2 flex h-9 w-9 items-center justify-center rounded-full border-2 transition-transform active:scale-95", foco, cor === c.id ? "border-foreground" : "border-transparent")}
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ backgroundColor: `hsl(${theme === "light" ? c.claro : c.escuro})` }}>
                    {cor === c.id && <Check className="h-3.5 w-3.5 text-white" aria-hidden="true" />}
                  </span>
                </button>
              ))}
            </div>
          </CampoDeFormulario>

          <CampoDeFormulario rotulo="Meu tema" apoio="Só para você, neste aparelho">
            <SeletorCompacto
              rotulo="Tema"
              modo="segmentado"
              opcoes={[
                { valor: "dark", rotulo: "Escuro", icone: <Moon className="h-3.5 w-3.5" /> },
                { valor: "light", rotulo: "Claro", icone: <Sun className="h-3.5 w-3.5" /> },
              ]}
              valor={theme}
              onEscolher={(v) => setTheme(v === "light" ? "light" : "dark")}
            />
          </CampoDeFormulario>
        </div>
      </Secao>

      <Secao titulo="Como fica" recolher={false}>
        <Previa cor={cor} tema={theme} logo={logo} nome={nome.trim() || conta.nome} />
      </Secao>
    </div>
  );
}

/** Uma miniatura do topo e de um botão com a escolha de agora, antes de salvar. */
function Previa({ cor, tema, logo, nome }: { cor: CorDaEmpresa; tema: "dark" | "light"; logo: string | null; nome: string }) {
  const c = CORES_DA_EMPRESA.filter((x) => x.id === cor)[0];
  const tom = `hsl(${tema === "light" ? c.claro : c.escuro})`;
  const textoDoBotao = tema === "light" ? "#fff" : `hsl(${c.textoNoEscuro})`;
  return (
    <div className={juntar(superficie.painel, "min-w-0 overflow-hidden")} data-previa-da-aparencia="" aria-hidden="true">
      <div className="flex h-11 min-w-0 items-center border-b border-border px-3">
        {logo ? <img src={logo} alt="" className="h-6 w-auto max-w-[110px] object-contain" /> : <span className={juntar(texto.corpo, "min-w-0 truncate font-semibold")}>{nome}</span>}
        <span className="min-w-0 flex-1" />
        <span className="ml-2 h-2 w-10 rounded-full bg-muted" />
        <span className="ml-2 h-2 w-10 rounded-full bg-muted" />
      </div>
      <div className="space-y-3 p-3">
        <span className="block h-2.5 w-2/3 rounded-full bg-muted" />
        <span className="block h-2.5 w-1/2 rounded-full bg-muted" />
        <div className="flex items-center">
          <span className="inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium" style={{ backgroundColor: tom, color: textoDoBotao }}>Novo negócio</span>
          <span className="ml-3 text-[12px] font-medium" style={{ color: tom }}>Ver agenda</span>
        </div>
        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <span className="block h-full w-3/5 rounded-full" style={{ backgroundColor: tom }} />
        </span>
      </div>
    </div>
  );
}
