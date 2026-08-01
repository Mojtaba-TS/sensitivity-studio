import { useState, type KeyboardEvent, type ReactNode } from "react"
import { ActionList, ActionMenu, BaseStyles, Button, Dialog, Flash, IconButton, Label, NavList, Pagination, Spinner, TextInput, ThemeProvider } from "@primer/react"
import { ArrowBothIcon, ArrowLeftIcon, CheckCircleFillIcon, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, ClockIcon, CodeIcon, GraphIcon, LockIcon, PlayIcon, PulseIcon, RepoIcon, SyncIcon, TableIcon } from "@primer/octicons-react"
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts"
import { generatePareto, inspectModel, runParetoSensitivity, runSensitivity, solveModel, type Objective, type Parameter, type ParetoPoint, type ParetoResult, type ParetoScenario, type ParetoSensitivityResult, type ScenarioResult, type SensitivityResult, type SolveResult, type TimeSeries } from "./api"
import { defaultSampleModel, modelLibrary, type SampleModel } from "./modelLibrary"
import "./App.css"

type Screen = "code" | "loading" | "parameters" | "results"
type SweepRange = { start: number; end: number; step: number }
const pageSize = 6

export default function App() {
  const [screen, setScreen] = useState<Screen>("code")
  const [code, setCode] = useState(() => localStorage.getItem("pyomo-code") ?? defaultSampleModel)
  const [guideOpen, setGuideOpen] = useState(false)
  const [parameters, setParameters] = useState<Parameter[]>([])
  const [objectives, setObjectives] = useState<Objective[]>([])
  const [primaryObjective, setPrimaryObjective] = useState("")
  const [secondaryObjective, setSecondaryObjective] = useState("")
  const [ranges, setRanges] = useState<Record<string, SweepRange>>({})
  const [activeParameter, setActiveParameter] = useState("")
  const [rangeParameter, setRangeParameter] = useState<string | null>(null)
  const [draftRange, setDraftRange] = useState<SweepRange>({ start: 0, end: 100, step: 10 })
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null)
  const [result, setResult] = useState<SolveResult | null>(null)
  const [sensitivity, setSensitivity] = useState<SensitivityResult | null>(null)
  const [pareto, setPareto] = useState<ParetoResult | null>(null)
  const [paretoSensitivity, setParetoSensitivity] = useState<ParetoSensitivityResult | null>(null)
  const [selectedPareto, setSelectedPareto] = useState<ParetoPoint | null>(null)
  const [paretoDetail, setParetoDetail] = useState<ParetoPoint | ParetoScenario | null>(null)
  const [running, setRunning] = useState(false)
  const [scenarioPage, setScenarioPage] = useState(1)
  const [detail, setDetail] = useState<ScenarioResult | null>(null)
  const values = Object.fromEntries(parameters.map(({ name, value }) => [name, value]))

  const loadSample = (sample: SampleModel) => {
    setCode(sample.code)
    setMessage(null)
    requestAnimationFrame(() => document.querySelector(".editor-window")?.scrollIntoView({ behavior: "smooth", block: "center" }))
  }

  const inspect = async () => {
    setScreen("loading")
    setMessage(null)
    try {
      const [response] = await Promise.all([inspectModel(code), new Promise((resolve) => setTimeout(resolve, 850))])
      localStorage.setItem("pyomo-code", code)
      setParameters(response.parameters)
      setObjectives(response.objectives)
      const activeObjectives = response.objectives.filter((objective) => objective.active)
      const firstObjective = activeObjectives[0] ?? response.objectives[0]
      const secondObjective = activeObjectives.find((objective) => objective.name !== firstObjective?.name) ?? response.objectives.find((objective) => objective.name !== firstObjective?.name)
      setPrimaryObjective(firstObjective?.name ?? "")
      setSecondaryObjective(secondObjective?.name ?? "")
      setActiveParameter(response.parameters[0]?.name ?? "")
      setRanges({})
      setResult(null)
      setSensitivity(null)
      setPareto(null)
      setParetoSensitivity(null)
      setSelectedPareto(null)
      setParetoDetail(null)
      setScreen("parameters")
      setMessage(response.parameters.length ? null : { tone: "danger", text: "This model has no mutable numeric parameters to analyse." })
    } catch (error) {
      setScreen("code")
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Model inspection failed." })
    }
  }

  const runOnce = async () => {
    setRunning(true)
    setMessage(null)
    try {
      const response = await solveModel(code, values)
      setResult(response)
      setSensitivity(null)
      setDetail(null)
      setScreen("results")
    } catch (error) { setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Solver run failed." }) }
    finally { setRunning(false) }
  }

  const runSweep = async () => {
    const lockedParameter = Object.keys(ranges)[0]
    const range = ranges[lockedParameter]
    if (!range) {
      setMessage({ tone: "danger", text: "Set and lock a start, end, and step for the selected parameter first." })
      return
    }
    setRunning(true)
    setMessage(null)
    try {
      const response = await runSensitivity(code, values, lockedParameter, range.start, range.end, range.step)
      setResult(null)
      setSensitivity(response)
      setDetail(response.scenarios[0] ?? null)
      setScenarioPage(1)
      setScreen("results")
      setMessage(null)
    } catch (error) { setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Scenario sweep failed." }) }
    finally { setRunning(false) }
  }

  const runPareto = async () => {
    if (!primaryObjective || !secondaryObjective || primaryObjective === secondaryObjective) {
      setMessage({ tone: "danger", text: "Choose two different objectives and select which one is primary." })
      return
    }
    setRunning(true)
    setMessage(null)
    try {
      const response = await generatePareto(code, values, primaryObjective, secondaryObjective, 10)
      setPareto(response)
      setParetoSensitivity(null)
      setSelectedPareto(null)
      setParetoDetail(null)
      setResult(null)
      setSensitivity(null)
      setScreen("results")
    } catch (error) { setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Pareto generation failed." }) }
    finally { setRunning(false) }
  }

  const runHybridSweep = async (configuredParameter?: string, configuredRange?: SweepRange) => {
    const lockedParameter = configuredParameter ?? Object.keys(ranges)[0]
    const range = configuredRange ?? ranges[lockedParameter]
    if (!range || !selectedPareto) {
      setMessage({ tone: "danger", text: "Generate the Pareto frontier, select a compromise, and lock a parameter range first." })
      return
    }
    setRanges({ [lockedParameter]: range })
    setActiveParameter(lockedParameter)
    setRunning(true)
    setMessage(null)
    try {
      const response = await runParetoSensitivity(code, values, lockedParameter, range.start, range.end, range.step, primaryObjective, secondaryObjective, selectedPareto.position)
      setParetoSensitivity(response)
      setParetoDetail(response.scenarios[0] ?? null)
      setScreen("results")
    } catch (error) { setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Hybrid Pareto sensitivity failed." }) }
    finally { setRunning(false) }
  }

  const openRange = (parameter: Parameter) => {
    const magnitude = Math.max(Math.abs(parameter.value), 10)
    setRangeParameter(parameter.name)
    setDraftRange(ranges[parameter.name] ?? {
      start: round(parameter.value - magnitude * .4),
      end: round(parameter.value + magnitude * .4),
      step: round(magnitude * .1),
    })
  }

  const rangeCount = draftRange.step > 0 && draftRange.end > draftRange.start ? Math.floor((draftRange.end - draftRange.start) / draftRange.step) + 1 : 0
  const rangeValid = rangeCount >= 2 && rangeCount <= 100
  const lockRange = () => {
    if (!rangeParameter || !rangeValid) return
    setRanges({ [rangeParameter]: draftRange })
    setActiveParameter(rangeParameter)
    setRangeParameter(null)
    setMessage(null)
    if (pareto && selectedPareto) setScreen("results")
  }

  const disableRange = () => {
    setRanges({})
    setMessage(null)
  }

  const scenarios = sensitivity?.scenarios ?? []
  const objectiveSense = scenarios[0]?.objective_sense ?? "maximize"
  const best = scenarios.reduce<ScenarioResult | null>((winner, item) => item.objective !== null && (!winner || winner.objective === null || (objectiveSense === "minimize" ? item.objective < winner.objective : item.objective > winner.objective)) ? item : winner, null)
  const rows = scenarios.slice((scenarioPage - 1) * pageSize, scenarioPage * pageSize)

  return <ThemeProvider><BaseStyles><div className="app-root">
    <GlobalHeader screen={screen} />
    {screen === "code" && <CodeScreen code={code} setCode={setCode} inspect={inspect} message={message} models={modelLibrary} loadSample={loadSample} openGuide={() => setGuideOpen(true)} />}
    {screen === "loading" && <LoadingScreen />}
    {(screen === "parameters" || screen === "results") && <WorkspaceHeader parameters={parameters.length} activeParameter={activeParameter} />}
    {(screen === "parameters" || screen === "results") && <div className="workspace-shell">
      <WorkspaceSidebar screen={screen} setScreen={setScreen} parameters={parameters} ranges={ranges} result={result} sensitivity={sensitivity} pareto={pareto} paretoSensitivity={paretoSensitivity} />
      <main className="workspace-main">
        {message && <div className="workspace-notice"><span>!</span><div><strong>Something needs attention</strong><p>{message.text}</p></div></div>}
        {screen === "parameters" && <ParametersPage parameters={parameters} objectives={objectives} primaryObjective={primaryObjective} secondaryObjective={secondaryObjective} setPrimaryObjective={(name) => { setPrimaryObjective(name); if (name === secondaryObjective) setSecondaryObjective(objectives.find((objective) => objective.name !== name)?.name ?? "") }} setSecondaryObjective={setSecondaryObjective} hasPareto={!!pareto} ranges={ranges} activeParameter={activeParameter} setActiveParameter={setActiveParameter} updateParameter={(name, value) => setParameters((items) => items.map((item) => item.name === name ? { ...item, value } : item))} openRange={openRange} disableRange={disableRange} runOnce={runOnce} runSweep={runSweep} runPareto={runPareto} running={running} />}
        {screen === "results" && (pareto || paretoSensitivity ? <ParetoResultsPage pareto={pareto} sensitivity={paretoSensitivity} selected={selectedPareto} detail={paretoDetail} setSelected={(point) => { setSelectedPareto(point); setParetoDetail(point); setParetoSensitivity(null) }} setDetail={setParetoDetail} parameters={parameters} ranges={ranges} running={running} runHybridSweep={runHybridSweep} backToFrontier={() => { setParetoSensitivity(null); setParetoDetail(selectedPareto) }} goParameters={() => setScreen("parameters")} /> : <ResultsPage result={result} sensitivity={sensitivity} best={best} rows={rows} page={scenarioPage} pageCount={Math.max(1, Math.ceil(scenarios.length / pageSize))} setPage={setScenarioPage} detail={detail} setDetail={setDetail} goParameters={() => setScreen("parameters")} />)}
      </main>
    </div>}
    {rangeParameter && <RangeDialog parameter={rangeParameter} range={draftRange} setRange={setDraftRange} count={rangeCount} valid={rangeValid} close={() => setRangeParameter(null)} save={lockRange} />}
    {guideOpen && <ModelGuide close={() => setGuideOpen(false)} />}
  </div></BaseStyles></ThemeProvider>
}

function GlobalHeader({ screen }: { screen: Screen }) {
  return <header className="global-header"><div className="global-left"><div className="global-logo">Σ</div><strong>Sensitivity Studio</strong></div><div className="header-guidance"><PulseIcon size={16} /><strong>{screen === "code" ? "Begin with your model" : screen === "loading" ? "Inspecting model structure" : "One parameter. One locked range. Every scenario."}</strong></div><div className="global-right"><RepoIcon size={14} /><span>Version 2.1</span></div></header>
}

function CodeScreen({ code, setCode, inspect, message, models, loadSample, openGuide }: { code: string; setCode: (value: string) => void; inspect: () => void; message: { tone: "info" | "danger"; text: string } | null; models: SampleModel[]; loadSample: (sample: SampleModel) => void; openGuide: () => void }) {
  const lineCount = code.split("\n").length
  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); inspect(); return }
    if (event.key !== "Tab") return
    event.preventDefault()
    const editor = event.currentTarget
    const start = editor.selectionStart
    const end = editor.selectionEnd
    setCode(`${code.slice(0, start)}    ${code.slice(end)}`)
    requestAnimationFrame(() => editor.setSelectionRange(start + 4, start + 4))
  }
  return <main className="code-page">{message && <Flash className="code-page-flash" variant={message.tone === "danger" ? "danger" : "default"}>{message.text}</Flash>}<section className="code-intro"><Label variant="accent">PYOMO WORKSPACE</Label><h1>Turn a model into an<br /><span>sensitivity story.</span></h1><p>Paste your Pyomo model. We’ll discover its mutable parameters, run HiGHS, and reveal how every scenario changes the optimum.</p><div className="flow-list"><FlowStep number="01" title="Paste or choose a model" text="Use a ConcreteModel named model." /><FlowStep number="02" title="Lock parameter ranges" text="Define the exact start, end, and step." /><FlowStep number="03" title="Explore every solution" text="Compare objectives, variables, and duals." /></div></section><section className="editor-window"><div className="editor-titlebar"><div><span className="window-dot red" /><span className="window-dot yellow" /><span className="window-dot green" /></div><div className="file-tab"><CodeIcon size={14} /> model.py</div><span className="editor-language">Python</span></div><textarea value={code} onChange={(event) => setCode(event.target.value)} onKeyDown={handleEditorKeyDown} spellCheck={false} aria-label="Pyomo model code" /><div className="editor-footer"><div className="editor-status"><span><CheckCircleFillIcon size={14} /> Local workspace</span><span>{lineCount} lines</span><span>Tab inserts spaces</span><span>Ctrl + Enter runs</span></div><Button variant="primary" leadingVisual={PlayIcon} onClick={inspect}>Analyse model</Button></div></section><section className="starter-library"><div className="starter-library-header"><div><Label variant="accent">STARTER MODELS</Label><h2>Explore real optimization models</h2><p>Load a verified example, inspect its Pyomo structure, and run it through the same solver pipeline.</p></div><Button leadingVisual={CodeIcon} onClick={openGuide}>Modeling guide</Button></div><div className="starter-model-grid">{models.map((sample) => <button className="starter-model-card" key={sample.id} onClick={() => loadSample(sample)}><div className="starter-card-top"><span className={`model-kind ${sample.category.toLowerCase().replace("-", "")}`}>{sample.category}</span><CodeIcon size={16} /></div><strong>{sample.title}</strong><p>{sample.description}</p><div className="model-capabilities">{sample.capabilities.map((capability) => <span key={capability}>{capability}</span>)}</div><span className="model-load">Load into editor <ChevronRightIcon size={14} /></span></button>)}</div></section></main>
}

function FlowStep({ number, title, text }: { number: string; title: string; text: string }) { return <div className="flow-step"><span>{number}</span><div><strong>{title}</strong><p>{text}</p></div></div> }

function ModelGuide({ close }: { close: () => void }) {
  const basicModel = `import pyomo.environ as pyo

model = pyo.ConcreteModel()
model.capacity = pyo.Param(initialize=100, mutable=True)
model.x = pyo.Var(domain=pyo.NonNegativeReals)
model.limit = pyo.Constraint(expr=model.x <= model.capacity)
model.profit = pyo.Objective(expr=12 * model.x, sense=pyo.maximize)`
  const biObjective = `model.total_cost = pyo.Objective(expr=cost_expression, sense=pyo.minimize)
model.total_emissions = pyo.Objective(expr=emission_expression, sense=pyo.minimize)`
  return <Dialog title="Pyomo model guide" subtitle="How to prepare LP, MILP, bi-objective, and time-indexed models for Sensitivity Studio." onClose={close} className="model-guide-dialog" width="960px" footerButtons={[{ buttonType: "primary", content: "Done", onClick: close }]}><Dialog.Body><div className="model-guide"><div className="guide-callout"><CheckCircleFillIcon size={18} /><div><strong>The samples use the real application contract</strong><p>Every starter model is parsed by Pyomo and verified with HiGHS—nothing in the library is a mocked result.</p></div></div><div className="guide-grid"><section><span className="guide-number">01</span><h3>Required structure</h3><p>Create a concrete model and expose it with the exact variable name <code>model</code>. Imports may use <code>pyomo.environ</code> or named Pyomo components.</p><pre><code>{basicModel}</code></pre></section><section><span className="guide-number">02</span><h3>Sensitivity parameters</h3><p>Parameters appear in the workspace only when they are numeric and declared with <code>mutable=True</code>. Scalar and indexed entries are supported.</p><ul><li>Use meaningful names such as <code>demand_scale</code> or <code>capacity</code>.</li><li>Choose physically valid Start, End, and Step values.</li><li>Only one parameter can be swept at a time.</li></ul></section><section><span className="guide-number">03</span><h3>Single-objective LP or MILP</h3><p>Define exactly one active objective. Continuous, integer, and binary variables are supported when the model remains linear.</p><ul><li>LP models can report imported constraint duals.</li><li>MILP models report variables and constraints, but not duals.</li><li>HiGHS returns the genuine optimal, infeasible, or unbounded status.</li></ul></section><section><span className="guide-number">04</span><h3>Bi-objective models</h3><p>Define two objective components. The app discovers their names and directions, then lets the user choose the primary and secondary objectives.</p><pre><code>{biObjective}</code></pre><p>The Pareto frontier is calculated with repeated ε-constraint solves. After selecting a Pareto point, hybrid sensitivity preserves that normalized preference across the chosen parameter range.</p></section><section><span className="guide-number">05</span><h3>Time-series output</h3><p>Name the time set clearly—such as <code>PERIODS</code>, <code>YEARS</code>, <code>STAGES</code>, or <code>HOURS</code>—and index variables or expressions by it.</p><ul><li>The app detects complete time-related name tokens automatically.</li><li>For a domain-specific name, add <code>model.sensitivity_time_set = "MY_HORIZON"</code>.</li><li>Select an aggregate Sum or Mean, or an exact indexed trajectory such as <code>generation · TECH=wind</code>.</li><li>Numerically insignificant solver noise is treated as zero and reported as no material variation.</li><li>Only scenarios with solved values enter the optional envelope; missing results remain visible as gaps.</li></ul></section><section><span className="guide-number">06</span><h3>Current support boundary</h3><p>Use linear Pyomo models solvable by HiGHS: LP and MILP. General nonlinear expressions, external solver callbacks, and indexed objective containers are not supported.</p><div className="guide-warning"><strong>Model meaning still matters.</strong><span>A mathematically feasible result can be operationally meaningless when a range allows values such as negative demand. Use domain-valid bounds.</span></div></section></div></div></Dialog.Body></Dialog>
}

function LoadingScreen() { return <main className="loading-page"><div className="loading-orbit"><div className="orbit-ring one" /><div className="orbit-ring two" /><div className="loading-core"><PulseIcon size={32} /></div></div><Label variant="accent">MODEL INSPECTION</Label><h1>Mapping your model</h1><p>Reading components, discovering mutable parameters, and preparing the solver workspace.</p><div className="loading-steps"><span className="done"><CheckCircleFillIcon /> Parse Python</span><span className="active"><Spinner size="small" /> Inspect parameters</span><span>Prepare workspace</span></div></main> }

function WorkspaceHeader({ parameters, activeParameter }: { parameters: number; activeParameter: string }) { return <div className="workspace-info"><div className="workspace-info-icon"><RepoIcon size={19} /></div><div><strong>Model sensitivity workspace</strong><span>Configure one parameter range and inspect every solver result in sequence.</span></div><div className="workspace-facts"><span><b>{parameters}</b> parameters</span><span><b>{activeParameter || "—"}</b> selected</span><span><b>HiGHS</b> solver</span></div></div> }

function WorkspaceSidebar({ screen, setScreen, parameters, ranges, result, sensitivity, pareto, paretoSensitivity }: { screen: Screen; setScreen: (screen: Screen) => void; parameters: Parameter[]; ranges: Record<string, SweepRange>; result: SolveResult | null; sensitivity: SensitivityResult | null; pareto: ParetoResult | null; paretoSensitivity: ParetoSensitivityResult | null }) {
  const hasResults = result || sensitivity || pareto || paretoSensitivity
  const mode = paretoSensitivity ? "Hybrid" : pareto ? "Pareto" : sensitivity ? "Sweep" : result ? "Single" : "None"
  return <aside className="workspace-sidebar"><NavList aria-label="Analysis"><NavList.Heading>Analysis</NavList.Heading><NavList.Item as="button" aria-current={screen === "parameters" ? "page" : undefined} onClick={() => setScreen("parameters")}><NavList.LeadingVisual><CodeIcon /></NavList.LeadingVisual>Parameters<NavList.TrailingVisual><span className="nav-count">{parameters.length}</span></NavList.TrailingVisual></NavList.Item><NavList.Item as="button" aria-current={screen === "results" ? "page" : undefined} onClick={() => setScreen("results")}><NavList.LeadingVisual><GraphIcon /></NavList.LeadingVisual>Results{hasResults && <NavList.TrailingVisual><span className="nav-status" /></NavList.TrailingVisual>}</NavList.Item></NavList><div className="sidebar-summary"><h3>Analysis summary</h3><div><span>Parameters</span><strong>{parameters.length}</strong></div><div><span>Locked parameter</span><strong>{Object.keys(ranges)[0] ?? "None"}</strong></div><div><span>Latest mode</span><strong>{mode}</strong></div></div><button className="replace-model" onClick={() => setScreen("code")}><SyncIcon /> Use another model</button></aside>
}

function ParametersPage({ parameters, objectives, primaryObjective, secondaryObjective, setPrimaryObjective, setSecondaryObjective, hasPareto, ranges, activeParameter, setActiveParameter, updateParameter, openRange, disableRange, runOnce, runSweep, runPareto, running }: { parameters: Parameter[]; objectives: Objective[]; primaryObjective: string; secondaryObjective: string; setPrimaryObjective: (name: string) => void; setSecondaryObjective: (name: string) => void; hasPareto: boolean; ranges: Record<string, SweepRange>; activeParameter: string; setActiveParameter: (name: string) => void; updateParameter: (name: string, value: number) => void; openRange: (parameter: Parameter) => void; disableRange: () => void; runOnce: () => void; runSweep: () => void; runPareto: () => void; running: boolean }) {
  const lockedParameter = Object.keys(ranges)[0] ?? ""
  const lockedRange = ranges[lockedParameter]
  const count = lockedRange ? Math.floor((lockedRange.end - lockedRange.start) / lockedRange.step) + 1 : 0
  const multiObjective = objectives.length >= 2
  if (multiObjective) return <MultiObjectiveParametersPage parameters={parameters} objectives={objectives} primaryObjective={primaryObjective} secondaryObjective={secondaryObjective} setPrimaryObjective={setPrimaryObjective} setSecondaryObjective={setSecondaryObjective} hasPareto={hasPareto} activeParameter={activeParameter} setActiveParameter={setActiveParameter} updateParameter={updateParameter} runPareto={runPareto} running={running} />
  return <div className="content-page"><div className="content-heading"><div><div className="breadcrumb"><span>Analysis</span><ChevronRightIcon size={14} /><strong>Parameters</strong></div><h1>Model parameters</h1><p>Change any values and run once, or lock one parameter for a scenario sweep.</p></div><div className="heading-actions"><Button leadingVisual={PlayIcon} onClick={runOnce} disabled={running || !!lockedRange}>{running ? "Running…" : "Run once"}</Button><Button variant="primary" leadingVisual={GraphIcon} onClick={runSweep} disabled={running || !lockedRange}>{running ? "Running…" : "Run sweep"}</Button></div></div><div className="parameter-grid"><section className="github-panel parameter-panel"><div className="panel-header"><div><h2>Mutable parameters</h2><p>Edit current values directly. Hover a row only when you want a sweep.</p></div><span className="discovery-count"><CheckCircleFillIcon /> {parameters.length} discovered</span></div>{parameters.map((parameter) => <div className={`github-row parameter-item ${activeParameter === parameter.name ? "selected" : ""}`} key={parameter.name} onClick={() => setActiveParameter(parameter.name)}><div className="parameter-identity"><div className="param-icon"><CodeIcon size={16} /></div><div><strong>{parameter.name}</strong><span>Mutable parameter entry</span></div></div><div className="parameter-controls" onClick={(event) => event.stopPropagation()}><TextInput type="number" aria-label={`${parameter.name} value`} value={parameter.value} onChange={(event) => updateParameter(parameter.name, Number(event.target.value))} />{ranges[parameter.name] ? <button className="range-pill locked" onClick={disableRange} title="Click to disable this sweep"><LockIcon size={13} /><span>{ranges[parameter.name].start} → {ranges[parameter.name].end}</span><small>Disable</small></button> : <div className="range-pill"><span>Single value</span></div>}<IconButton className="range-action" icon={ArrowBothIcon} aria-label={`Set sweep for ${parameter.name}`} tooltipDirection="w" onClick={() => openRange(parameter)} /></div></div>)}</section><aside className="sweep-card"><div className="sweep-visual"><GraphIcon size={24} /></div><Label variant="accent">OPTIONAL SWEEP</Label><h2>{lockedParameter || "Run once or add a sweep"}</h2>{lockedRange ? <><div className="range-track"><span style={{ left: "8%" }} /><span style={{ left: "50%" }} /><span style={{ left: "92%" }} /></div><div className="range-values"><div><span>Start</span><strong>{lockedRange.start}</strong></div><div><span>End</span><strong>{lockedRange.end}</strong></div><div><span>Step</span><strong>{lockedRange.step}</strong></div></div><div className="scenario-count"><strong>{count}</strong><span>solver scenarios will run · click the locked range to disable</span></div></> : <div className="no-range"><PlayIcon size={20} /><p>You can run the current values immediately. To compare scenarios, hover one parameter and lock its sweep.</p></div>}</aside></div></div>
}

function MultiObjectiveParametersPage({ parameters, objectives, primaryObjective, secondaryObjective, setPrimaryObjective, setSecondaryObjective, hasPareto, activeParameter, setActiveParameter, updateParameter, runPareto, running }: { parameters: Parameter[]; objectives: Objective[]; primaryObjective: string; secondaryObjective: string; setPrimaryObjective: (name: string) => void; setSecondaryObjective: (name: string) => void; hasPareto: boolean; activeParameter: string; setActiveParameter: (name: string) => void; updateParameter: (name: string, value: number) => void; runPareto: () => void; running: boolean }) {
  return <div className="content-page">
    <div className="content-heading"><div><div className="breadcrumb"><span>Analysis</span><ChevronRightIcon size={14} /><strong>Parameters</strong></div><h1>Bi-objective analysis</h1><p>Configure the objectives and base values. Select a compromise and its sensitivity range in the frontier workspace.</p></div><div className="heading-actions"><Button variant="primary" leadingVisual={GraphIcon} onClick={runPareto} disabled={running}>{running ? "Generating…" : hasPareto ? "Regenerate frontier" : "Generate frontier"}</Button></div></div>
    <ObjectiveSetup objectives={objectives} primary={primaryObjective} secondary={secondaryObjective} setPrimary={setPrimaryObjective} setSecondary={setSecondaryObjective} />
    <div className="parameter-grid">
      <section className="github-panel parameter-panel multi-parameter-panel"><div className="panel-header"><div><h2>Mutable parameters</h2><p>Edit the base values used to generate the frontier.</p></div><span className="discovery-count"><CheckCircleFillIcon /> {parameters.length} discovered</span></div>{parameters.map((parameter) => <div className={`github-row parameter-item ${activeParameter === parameter.name ? "selected" : ""}`} key={parameter.name} onClick={() => setActiveParameter(parameter.name)}><div className="parameter-identity"><div className="param-icon"><CodeIcon size={16} /></div><div><strong>{parameter.name}</strong><span>Base parameter value</span></div></div><div className="parameter-controls base-only" onClick={(event) => event.stopPropagation()}><TextInput type="number" aria-label={`${parameter.name} value`} value={parameter.value} onChange={(event) => updateParameter(parameter.name, Number(event.target.value))} /></div></div>)}</section>
      <aside className="sweep-card bi-workflow-card"><div className="sweep-visual"><GraphIcon size={24} /></div><Label variant="accent">GUIDED ANALYSIS</Label><h2>Frontier first</h2><div className="workflow-steps"><div><span>1</span><div><strong>Configure objectives</strong><p>Choose the two outcomes and their base inputs.</p></div></div><div><span>2</span><div><strong>Generate the frontier</strong><p>Calculate ten feasible trade-off points.</p></div></div><div><span>3</span><div><strong>Select and analyse</strong><p>Pick a compromise, set a range, and run hybrid sensitivity.</p></div></div></div></aside>
    </div>
  </div>
}

function ObjectiveSetup({ objectives, primary, secondary, setPrimary, setSecondary }: { objectives: Objective[]; primary: string; secondary: string; setPrimary: (name: string) => void; setSecondary: (name: string) => void }) {
  return <section className="github-panel objective-setup"><div className="panel-header"><div><h2>Bi-objective configuration</h2><p>ε-constraint · 10 Pareto points · choose the objective HiGHS optimizes directly</p></div><Label variant="accent">{objectives.length} objectives discovered</Label></div><div className="objective-choice-grid"><label><span>Primary objective</span><PrimerMenuSelect ariaLabel="Primary objective" value={primary} options={objectives.map((objective) => ({ value: objective.name, label: objective.name, description: objective.sense }))} onChange={setPrimary} /><small>Optimized directly at each Pareto point</small></label><div className="objective-direction"><ArrowBothIcon size={20} /><strong>ε-constraint</strong><span>Trade-off frontier</span></div><label><span>Secondary objective</span><PrimerMenuSelect ariaLabel="Secondary objective" value={secondary} options={objectives.filter((objective) => objective.name !== primary).map((objective) => ({ value: objective.name, label: objective.name, description: objective.sense }))} onChange={setSecondary} /><small>Progressively tightened across 10 ε levels</small></label></div></section>
}

type MenuOption = { value: string; label: string; description?: string }

function PrimerMenuSelect({ value, options, onChange, ariaLabel, tone = "light" }: { value: string; options: MenuOption[]; onChange: (value: string) => void; ariaLabel: string; tone?: "light" | "dark" }) {
  const selected = options.find((option) => option.value === value) ?? options[0]
  return <div className={`primer-menu-select ${tone}`}><ActionMenu><ActionMenu.Button className="primer-menu-button" aria-label={ariaLabel}>{selected ? <span className="primer-menu-value"><strong>{selected.label}</strong>{selected.description && <small>{selected.description}</small>}</span> : "Select an option"}</ActionMenu.Button><ActionMenu.Overlay align="start" width="medium" maxHeight="medium"><ActionList selectionVariant="single" className="primer-menu-list">{options.map((option) => <ActionList.Item key={option.value} selected={option.value === value} onSelect={() => onChange(option.value)}><span className="primer-menu-option">{option.label}</span>{option.description && <ActionList.Description variant="inline">{option.description}</ActionList.Description>}</ActionList.Item>)}</ActionList></ActionMenu.Overlay></ActionMenu></div>
}

function RangeDialog({ parameter, range, setRange, count, valid, close, save }: { parameter: string; range: SweepRange; setRange: (range: SweepRange) => void; count: number; valid: boolean; close: () => void; save: () => void }) {
  const warning = suspiciousRangeWarning(parameter, range)
  return <Dialog title={`Lock range · ${parameter}`} subtitle="Define the exact sequence of values used for sensitivity scenarios." onClose={close} width="large" footerButtons={[{ buttonType: "default", content: "Cancel", onClick: close }, { buttonType: "primary", content: "Lock range", onClick: save, disabled: !valid }]}><Dialog.Body><div className="range-dialog"><div className="range-fields"><label><span>Start value</span><TextInput type="number" value={range.start} onChange={(event) => setRange({ ...range, start: Number(event.target.value) })} /></label><label><span>End value</span><TextInput type="number" value={range.end} onChange={(event) => setRange({ ...range, end: Number(event.target.value) })} /></label><label><span>Step size</span><TextInput type="number" min="0.000001" value={range.step} onChange={(event) => setRange({ ...range, step: Number(event.target.value) })} /></label></div><div className={`range-preview ${valid ? "valid" : "invalid"}`}><div><ArrowBothIcon size={18} /><strong>{valid ? `${count} scenarios` : "Invalid range"}</strong></div><span>{valid ? `${range.start}, ${round(range.start + range.step)}, ${round(range.start + range.step * 2)} … ${range.end}` : count > 100 ? "Use a larger step; the maximum is 100 scenarios." : "End must be above start and step must be positive."}</span></div>{warning && <div className="semantic-range-warning"><span>!</span><p><strong>Check the model meaning.</strong>{warning}</p></div>}</div></Dialog.Body></Dialog>
}

function suspiciousRangeWarning(parameter: string, range: SweepRange) {
  const nonnegativeMeaning = /(scale|factor|ratio|rate|demand|capacity|cost|price|emission|limit|budget|supply)/i.test(parameter)
  if (range.start < 0 && nonnegativeMeaning) return ` This range includes negative values for ${parameter}. The solver may accept them even when they are not physically meaningful.`
  return null
}

function ParetoResultsPage({ pareto, sensitivity, selected, detail, setSelected, setDetail, parameters, ranges, running, runHybridSweep, backToFrontier, goParameters }: { pareto: ParetoResult | null; sensitivity: ParetoSensitivityResult | null; selected: ParetoPoint | null; detail: ParetoPoint | ParetoScenario | null; setSelected: (point: ParetoPoint) => void; setDetail: (point: ParetoPoint | ParetoScenario) => void; parameters: Parameter[]; ranges: Record<string, SweepRange>; running: boolean; runHybridSweep: (parameter: string, range: SweepRange) => void; backToFrontier: () => void; goParameters: () => void }) {
  const [hoveredPoint, setHoveredPoint] = useState<ParetoPoint | null>(null)
  const initialHybridParameter = Object.keys(ranges)[0] ?? parameters[0]?.name ?? ""
  const initialHybridValue = parameters.find((parameter) => parameter.name === initialHybridParameter)?.value ?? 0
  const [hybridParameter, setHybridParameter] = useState(initialHybridParameter)
  const [hybridRange, setHybridRange] = useState<SweepRange>(() => ranges[initialHybridParameter] ?? suggestedSweepRange(initialHybridValue))
  const hybridCount = hybridRange.step > 0 && hybridRange.end >= hybridRange.start ? Math.floor((hybridRange.end - hybridRange.start) / hybridRange.step) + 1 : 0
  const hybridRangeValid = !!hybridParameter && hybridCount >= 2 && hybridCount <= 30
  const hybridRangeWarning = suspiciousRangeWarning(hybridParameter, hybridRange)
  const chooseHybridParameter = (name: string) => {
    const value = parameters.find((parameter) => parameter.name === name)?.value ?? 0
    setHybridParameter(name)
    setHybridRange(ranges[name] ?? suggestedSweepRange(value))
  }
  if (sensitivity) return <ParetoSensitivityResults sensitivity={sensitivity} detail={detail as ParetoScenario | null} setDetail={setDetail} backToFrontier={backToFrontier} goParameters={goParameters} />
  if (!pareto) return <div className="content-page"><EmptyResults goParameters={goParameters} /></div>
  const current = detail ?? selected ?? pareto.points[0]
  const primary = pareto.primary_objective
  const secondary = pareto.secondary_objective
  const primarySense = pareto.objectives.find((objective) => objective.name === primary)?.sense ?? "minimize"
  const secondarySense = pareto.objectives.find((objective) => objective.name === secondary)?.sense ?? "minimize"
  const chartData: ParetoChartDatum[] = pareto.points.map((point) => ({ x: point.objective_values[primary], y: point.objective_values[secondary], point }))
  const preview = hoveredPoint ?? selected ?? pareto.points[0]
  return <div className="content-page">
    <div className="content-heading"><div><div className="breadcrumb"><span>Analysis</span><ChevronRightIcon size={14} /><strong>Pareto frontier</strong></div><h1>Bi-objective trade-off</h1><p>Select a compromise, then configure its sensitivity analysis beside the frontier.</p></div><div className="heading-actions pareto-heading-actions"><Button leadingVisual={ArrowLeftIcon} onClick={goParameters}>Back to parameters</Button></div></div>
    <section className="hero-metrics"><Metric icon={<GraphIcon />} label="Pareto points" value={String(pareto.points.length)} accent="blue" /><Metric icon={<CodeIcon />} label={primary} value={formatNumber(current?.objective_values[primary] ?? null)} accent="purple" /><Metric icon={<ArrowBothIcon />} label={secondary} value={formatNumber(current?.objective_values[secondary] ?? null)} accent="amber" /><Metric icon={<CheckCircleFillIcon />} label="Method" value="ε-constraint" accent="green" /></section>
    <div className={`pareto-workspace ${selected ? "configured" : ""}`}>
    <section className="github-panel chart-panel pareto-chart-panel">
      <div className="panel-header"><div><h2>Pareto frontier</h2><p>Hover to compare. Click a point to preserve that compromise.</p></div><Label variant="accent">{pareto.points.length} ε levels</Label></div>
      <div className="pareto-selection-strip" aria-live="polite">
        <div className="pareto-selection-name"><span>{hoveredPoint ? "Previewing" : selected ? "Selected" : "Choose a point"}</span><strong>Pareto {String(preview.index).padStart(2, "0")}</strong></div>
        <div className="pareto-selection-value"><span>{primary}</span><strong>{formatNumber(preview.objective_values[primary] ?? null)}</strong></div>
        <div className="pareto-selection-value"><span>{secondary}</span><strong>{formatNumber(preview.objective_values[secondary] ?? null)}</strong></div>
        <div className="pareto-preference"><span>ε preference</span><strong>{(preview.position * 100).toFixed(0)}%</strong><div><i style={{ width: `${preview.position * 100}%` }} /></div></div>
      </div>
      <div className="chart-area pareto-chart-area" onMouseLeave={() => setHoveredPoint(null)}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 34, bottom: 22, left: 30 }}>
            <CartesianGrid stroke="#d8dee4" strokeDasharray="3 3" />
            <XAxis type="number" dataKey="x" name={primary} domain={["dataMin", "dataMax"]} tickLine={false} axisLine={{ stroke: "#8c959f" }} tickFormatter={(value) => Number(value).toFixed(2)} tick={{ fill: "#57606a", fontSize: 11 }} tickMargin={12} padding={{ left: 28, right: 28 }} />
            <YAxis type="number" dataKey="y" name={secondary} domain={["dataMin", "dataMax"]} tickLine={false} axisLine={{ stroke: "#8c959f" }} tickFormatter={(value) => Number(value).toFixed(2)} tick={{ fill: "#57606a", fontSize: 11 }} tickMargin={12} width={82} padding={{ top: 24, bottom: 24 }} />
            <Tooltip cursor={{ stroke: "#8c959f", strokeDasharray: "4 4" }} content={<ParetoChartTooltip primary={primary} secondary={secondary} />} />
            <Scatter
              data={chartData}
              fill="#0969da"
              line={{ stroke: "#0969da", strokeWidth: 2.5 }}
              shape={(shapeProps) => {
                const dot = shapeProps as unknown as { cx?: number; cy?: number; payload?: ParetoChartDatum }
                return <InteractiveParetoDot cx={dot.cx} cy={dot.cy} datum={dot.payload} selectedIndex={selected?.index ?? null} hoveredIndex={hoveredPoint?.index ?? null} onHover={setHoveredPoint} onSelect={setSelected} primary={primary} secondary={secondary} />
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend pareto-legend"><span><i className="legend-line" /> Feasible frontier</span><span>X: {primary} · {primarySense}</span><span>Y: {secondary} · {secondarySense}</span><span className="chart-hint">Click any point to select it</span></div>
    </section>
    {selected && <aside className="hybrid-config-panel">
      <div className="hybrid-config-head"><Label variant="accent">HYBRID SENSITIVITY</Label><span>Step 3 of 3</span></div>
      <div className="hybrid-selected-point"><span>Selected compromise</span><strong>Pareto {String(selected.index).padStart(2, "0")}</strong><small>{(selected.position * 100).toFixed(0)}% ε preference</small></div>
      <label className="hybrid-field"><span>Parameter</span><PrimerMenuSelect ariaLabel="Sensitivity parameter" tone="dark" value={hybridParameter} options={parameters.map((parameter) => ({ value: parameter.name, label: parameter.name, description: formatNumber(parameter.value) }))} onChange={chooseHybridParameter} /></label>
      <div className="hybrid-range-fields"><HybridNumberField label="Start" value={hybridRange.start} nudge={Math.max(Math.abs(hybridRange.step), 0.001)} onChange={(value) => setHybridRange({ ...hybridRange, start: value })} /><HybridNumberField label="End" value={hybridRange.end} nudge={Math.max(Math.abs(hybridRange.step), 0.001)} onChange={(value) => setHybridRange({ ...hybridRange, end: value })} /><HybridNumberField label="Step" value={hybridRange.step} nudge={Math.max(Math.abs(hybridRange.step) / 10, 0.001)} min={0.001} onChange={(value) => setHybridRange({ ...hybridRange, step: value })} /></div>
      {hybridRangeWarning && <div className="hybrid-range-warning"><span>!</span><p>{hybridRangeWarning}</p></div>}
      <div className={`hybrid-run-summary ${hybridRangeValid ? "valid" : "invalid"}`}><strong>{hybridRangeValid ? hybridCount : "—"}</strong><span>{hybridRangeValid ? "compromise-preserving scenarios" : hybridCount > 30 ? "Maximum 30 scenarios" : "Enter a valid increasing range"}</span></div>
      <Button className="hybrid-run-button" variant="primary" leadingVisual={PulseIcon} onClick={() => runHybridSweep(hybridParameter, hybridRange)} disabled={running || !hybridRangeValid}>{running ? "Running…" : "Run hybrid sweep"}</Button>
      <p className="hybrid-config-note">Each scenario preserves this Pareto preference while changing the selected parameter.</p>
    </aside>}
    </div>
    <section className="github-panel scenario-table pareto-table"><div className="panel-header"><div><h2>Compromise points</h2><p>The chart and table share the same selected solution.</p></div><span className="table-badge"><TableIcon /> {pareto.points.length} points</span></div><div className="table-scroll"><table><thead><tr><th>Point</th><th>{primary}</th><th>{secondary}</th><th>ε position</th><th>Time</th><th>Status</th><th /></tr></thead><tbody>{pareto.points.map((point) => <tr key={point.index} className={selected?.index === point.index ? "active-row" : ""} tabIndex={0} aria-label={`Select Pareto point ${point.index}`} onClick={() => setSelected(point)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(point) } }}><td><strong>Pareto {String(point.index).padStart(2, "0")}</strong></td><td>{formatNumber(point.objective_values[primary] ?? null)}</td><td>{formatNumber(point.objective_values[secondary] ?? null)}</td><td>{(point.position * 100).toFixed(0)}%</td><td>{point.elapsed_ms.toFixed(2)} ms</td><td><Label variant={point.status.toLowerCase() === "optimal" ? "success" : "attention"}>{point.status}</Label></td><td><ChevronRightIcon /></td></tr>)}</tbody></table></div></section>
    {current && <SolutionDetail result={current} title={`Pareto ${String(current.index).padStart(2, "0")}`} />}
  </div>
}

type ParetoChartDatum = { x: number | null; y: number | null; point: ParetoPoint }

function HybridNumberField({ label, value, nudge, min, onChange }: { label: string; value: number; nudge: number; min?: number; onChange: (value: number) => void }) {
  const changeBy = (direction: -1 | 1) => onChange(Math.max(min ?? -Infinity, round(value + direction * nudge)))
  return <label><span>{label}</span><div className="hybrid-number-field"><input type="number" step="any" min={min} value={value} aria-label={`${label} value`} onChange={(event) => onChange(Number(event.target.value))} /><div className="hybrid-number-actions"><button type="button" aria-label={`Increase ${label.toLowerCase()}`} onClick={() => changeBy(1)}><ChevronUpIcon size={12} /></button><button type="button" aria-label={`Decrease ${label.toLowerCase()}`} onClick={() => changeBy(-1)}><ChevronDownIcon size={12} /></button></div></div></label>
}

function InteractiveParetoDot({ cx, cy, datum, selectedIndex, hoveredIndex, onHover, onSelect, primary, secondary }: { cx?: number; cy?: number; datum?: ParetoChartDatum; selectedIndex: number | null; hoveredIndex: number | null; onHover: (point: ParetoPoint | null) => void; onSelect: (point: ParetoPoint) => void; primary: string; secondary: string }) {
  if (cx === undefined || cy === undefined || !datum) return <g />
  const selected = datum.point.index === selectedIndex
  const hovered = datum.point.index === hoveredIndex
  const label = `Pareto ${datum.point.index}: ${primary} ${formatNumber(datum.x)}, ${secondary} ${formatNumber(datum.y)}. Press Enter to select.`
  return <g className={`pareto-dot ${selected ? "selected" : ""} ${hovered ? "hovered" : ""}`} role="button" tabIndex={0} aria-label={label} transform={`translate(${cx} ${cy})`} onMouseEnter={() => onHover(datum.point)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(datum.point)} onBlur={() => onHover(null)} onClick={() => onSelect(datum.point)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(datum.point) } }}>
    <circle className="pareto-dot-hit" r="16" />
    <circle className="pareto-dot-halo" r={selected ? 11 : 9} />
    <circle className="pareto-dot-core" r={selected ? 5.5 : 4.5} />
  </g>
}

function ParetoChartTooltip({ active, payload, primary, secondary }: { active?: boolean; payload?: ReadonlyArray<{ payload?: ParetoChartDatum }>; primary: string; secondary: string }) {
  const point = payload?.[0]?.payload?.point
  if (!active || !point) return null
  return <div className="pareto-tooltip"><div><span>Trade-off candidate</span><strong>Pareto {String(point.index).padStart(2, "0")}</strong></div><dl><dt>{primary}</dt><dd>{formatNumber(point.objective_values[primary] ?? null)}</dd><dt>{secondary}</dt><dd>{formatNumber(point.objective_values[secondary] ?? null)}</dd><dt>ε preference</dt><dd>{(point.position * 100).toFixed(0)}%</dd></dl><p>Click to keep this compromise</p></div>
}

function HybridActiveDot({ cx, cy, color }: { cx?: number; cy?: number; color: string }) {
  if (cx === undefined || cy === undefined) return <g />
  return <g transform={`translate(${cx} ${cy})`} className="hybrid-active-dot"><circle r="12" fill={color} opacity=".14" /><circle r="6" fill={color} stroke="#fff" strokeWidth="2.5" /><circle r="2" fill="#fff" /></g>
}

type HybridResponseDatum = { parameter: number; primary: number | null; secondary: number | null; status: string; scenario: ParetoScenario | null }

function InteractiveHybridDot({ cx, cy, datum, color, selectedIndex, onSelect }: { cx?: number; cy?: number; datum?: HybridResponseDatum; color: string; selectedIndex: number; onSelect: (scenario: ParetoScenario) => void }) {
  if (cx === undefined || cy === undefined || !datum?.scenario) return <g />
  const selected = datum.scenario.index === selectedIndex
  return <g className={`hybrid-point ${selected ? "selected" : ""}`} style={{ color }} transform={`translate(${cx} ${cy})`} role="button" tabIndex={0} aria-label={`Select scenario ${datum.scenario.index} at parameter ${datum.parameter.toFixed(2)}`} onClick={() => onSelect(datum.scenario!)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(datum.scenario!) } }}><circle className="hybrid-point-hit" r="14" /><circle className="hybrid-point-halo" r="9" fill={color} /><circle className="hybrid-point-core" r="4" fill="#fff" stroke={color} strokeWidth="2.25" /></g>
}

function HybridChartTooltip({ active, payload, parameter, primary, secondary }: { active?: boolean; payload?: ReadonlyArray<{ payload?: { parameter: number; primary: number | null; secondary: number | null; status: string } }>; parameter: string; primary: string; secondary: string }) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return <div className="pareto-tooltip hybrid-tooltip"><div><span>Hybrid scenario</span><strong>{parameter} {point.parameter.toFixed(2)}</strong></div><dl><dt>{primary}</dt><dd>{formatNumber(point.primary)}</dd><dt>{secondary}</dt><dd>{formatNumber(point.secondary)}</dd><dt>Status</dt><dd>{point.status}</dd></dl><p>Both objectives at this parameter value</p></div>
}

function ParetoSensitivityResults({ sensitivity, detail, setDetail, backToFrontier, goParameters }: { sensitivity: ParetoSensitivityResult; detail: ParetoScenario | null; setDetail: (point: ParetoPoint | ParetoScenario) => void; backToFrontier: () => void; goParameters: () => void }) {
  const current = detail ?? sensitivity.scenarios[0]
  const primary = sensitivity.primary_objective
  const secondary = sensitivity.secondary_objective
  const chartData: HybridResponseDatum[] = sensitivity.points.map((point) => ({ ...point, scenario: sensitivity.scenarios.find((scenario) => scenario.parameter === point.parameter) ?? null }))
  if (!current) return <div className="content-page"><EmptyResults goParameters={goParameters} /></div>
  return <div className="content-page">
    <div className="content-heading"><div><div className="breadcrumb"><span>Analysis</span><ChevronRightIcon size={14} /><span>Pareto frontier</span><ChevronRightIcon size={14} /><strong>Hybrid sensitivity</strong></div><h1>Compromise sensitivity</h1><p>The same normalized Pareto preference is recalculated at every {sensitivity.parameter} value.</p></div><div className="heading-actions hybrid-flow-actions"><Button leadingVisual={ArrowLeftIcon} onClick={backToFrontier}>Pareto frontier</Button><Button onClick={goParameters}>Model parameters</Button></div></div>
    <section className="hero-metrics"><Metric icon={<CodeIcon />} label={primary} value={formatNumber(current.objective_values[primary] ?? null)} accent="blue" /><Metric icon={<ArrowBothIcon />} label={secondary} value={formatNumber(current.objective_values[secondary] ?? null)} accent="purple" /><Metric icon={<ClockIcon />} label="Solve time" value={`${current.elapsed_ms.toFixed(2)} ms`} accent="amber" /><Metric icon={<CheckCircleFillIcon />} label="Preference" value={`${(sensitivity.position * 100).toFixed(0)}% ε`} accent="green" /></section>
    <section className="github-panel chart-panel hybrid-response-panel"><div className="panel-header"><div><h2>Two-objective response</h2><p>Both objectives across the locked {sensitivity.parameter} range · click a point to select its scenario</p></div><Label variant="accent"><PulseIcon /> Hybrid sweep</Label></div><div className="chart-area hybrid-chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 20, right: 34, bottom: 20, left: 28 }}><defs><linearGradient id="hybridPrimaryFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0969da" stopOpacity={.2} /><stop offset="100%" stopColor="#0969da" stopOpacity={.02} /></linearGradient><linearGradient id="hybridSecondaryFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8250df" stopOpacity={.16} /><stop offset="100%" stopColor="#8250df" stopOpacity={.015} /></linearGradient></defs><CartesianGrid stroke="#d8dee4" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="parameter" tickLine={false} axisLine={false} tickFormatter={(value) => Number(value).toFixed(2)} tick={{ fill: "#57606a", fontSize: 11 }} tickMargin={12} padding={{ left: 24, right: 24 }} /><YAxis yAxisId="primary" domain={["dataMin", "dataMax"]} tickLine={false} axisLine={false} tickFormatter={(value) => Number(value).toFixed(2)} tick={{ fill: "#0969da", fontSize: 11 }} tickMargin={12} width={86} padding={{ top: 24, bottom: 24 }} /><YAxis yAxisId="secondary" domain={["dataMin", "dataMax"]} orientation="right" tickLine={false} axisLine={false} tickFormatter={(value) => Number(value).toFixed(2)} tick={{ fill: "#8250df", fontSize: 11 }} tickMargin={12} width={86} padding={{ top: 24, bottom: 24 }} /><Tooltip cursor={{ stroke: "#8c959f", strokeDasharray: "4 4" }} content={<HybridChartTooltip parameter={sensitivity.parameter} primary={primary} secondary={secondary} />} /><Area yAxisId="primary" type="monotone" dataKey="primary" stroke="#0969da" strokeWidth={3} fill="url(#hybridPrimaryFill)" baseValue="dataMin" dot={(props: unknown) => { const dot = props as { cx?: number; cy?: number; payload?: HybridResponseDatum }; return <InteractiveHybridDot cx={dot.cx} cy={dot.cy} datum={dot.payload} color="#0969da" selectedIndex={current.index} onSelect={setDetail} /> }} activeDot={<HybridActiveDot color="#0969da" />} /><Area yAxisId="secondary" type="monotone" dataKey="secondary" stroke="#8250df" strokeWidth={3} fill="url(#hybridSecondaryFill)" baseValue="dataMin" dot={(props: unknown) => { const dot = props as { cx?: number; cy?: number; payload?: HybridResponseDatum }; return <InteractiveHybridDot cx={dot.cx} cy={dot.cy} datum={dot.payload} color="#8250df" selectedIndex={current.index} onSelect={setDetail} /> }} activeDot={<HybridActiveDot color="#8250df" />} /></AreaChart></ResponsiveContainer></div><div className="chart-legend hybrid-chart-legend"><span><i className="legend-line" /> {primary}</span><span className="purple-legend"><i className="legend-line" /> {secondary}</span><span>X: {sensitivity.parameter}</span><span className="hybrid-range-note">Axes fit observed values</span></div></section>
    <TemporalComparison baseline={sensitivity.baseline} scenarios={sensitivity.scenarios} selected={current} parameter={sensitivity.parameter} />
    <section className="github-panel scenario-table pareto-table"><div className="panel-header"><div><h2>Hybrid scenarios</h2><p>Select a row to inspect variables and duals at that compromise</p></div><span className="table-badge"><TableIcon /> {sensitivity.scenarios.length} runs</span></div><div className="table-scroll"><table><thead><tr><th>Run</th><th>{sensitivity.parameter}</th><th>{primary}</th><th>{secondary}</th><th>Time</th><th>Status</th><th /></tr></thead><tbody>{sensitivity.scenarios.map((scenario) => <tr key={scenario.index} className={current.index === scenario.index ? "active-row" : ""} onClick={() => setDetail(scenario)}><td><strong>Scenario {String(scenario.index).padStart(2, "0")}</strong></td><td>{scenario.parameter.toFixed(2)}</td><td>{formatNumber(scenario.objective_values[primary] ?? null)}</td><td>{formatNumber(scenario.objective_values[secondary] ?? null)}</td><td>{scenario.elapsed_ms.toFixed(2)} ms</td><td><Label variant={scenario.status.toLowerCase() === "optimal" ? "success" : "attention"}>{scenario.status}</Label></td><td><ChevronRightIcon /></td></tr>)}</tbody></table></div></section>
    <SolutionDetail result={current} title={`Scenario ${String(current.index).padStart(2, "0")}`} />
  </div>
}

function ResultsPage({ result, sensitivity, best, rows, page, pageCount, setPage, detail, setDetail, goParameters }: { result: SolveResult | null; sensitivity: SensitivityResult | null; best: ScenarioResult | null; rows: ScenarioResult[]; page: number; pageCount: number; setPage: (page: number) => void; detail: ScenarioResult | null; setDetail: (item: ScenarioResult) => void; goParameters: () => void }) {
  const current = detail ?? best ?? result
  const baselineObjective = sensitivity?.scenarios[0]?.objective
  const sense = current?.objective_sense ?? "maximize"
  const improvement = best?.objective !== null && best?.objective !== undefined && baselineObjective !== null && baselineObjective !== undefined ? (sense === "minimize" ? baselineObjective - best.objective : best.objective - baselineObjective) : null
  if (!current) return <div className="content-page"><EmptyResults goParameters={goParameters} /></div>
  return <div className="content-page"><div className="content-heading"><div><div className="breadcrumb"><span>Analysis</span><ChevronRightIcon size={14} /><strong>Results</strong></div><h1>{sensitivity ? "Scenario results" : "Single run result"}</h1><p>{sensitivity ? `${sensitivity.scenarios.length} solver runs across ${sensitivity.parameter}. Best means ${sense === "minimize" ? "lowest" : "highest"} objective.` : "Solution for the current parameter values."}</p></div><Button leadingVisual={ArrowLeftIcon} onClick={goParameters}>Back to parameters</Button></div><section className="hero-metrics">{sensitivity ? <><Metric icon={<GraphIcon />} label="Best objective" value={formatNumber(best?.objective ?? null)} accent="blue" /><Metric icon={<ArrowBothIcon />} label="Delta" value={improvement === null ? "—" : `+${formatNumber(improvement)}`} accent="purple" /></> : <><Metric icon={<GraphIcon />} label="Objective value" value={formatNumber(result?.objective ?? null)} accent="blue" /><Metric icon={<ArrowBothIcon />} label="Objective sense" value={sense === "minimize" ? "Minimize" : "Maximize"} accent="purple" /></>}<Metric icon={<ClockIcon />} label="Solve time" value={`${current.elapsed_ms.toFixed(2)} ms`} accent="amber" /><Metric icon={<CheckCircleFillIcon />} label="Status" value={current.status} accent="green" /></section>{sensitivity && <section className="github-panel chart-panel"><div className="panel-header"><div><h2>Objective landscape</h2><p>Objective value across the locked {sensitivity.parameter} range</p></div><Label variant="accent"><PulseIcon /> Scenario sweep</Label></div><div className="chart-area"><ResponsiveContainer width="100%" height="100%"><AreaChart data={sensitivity.points} accessibilityLayer={false} margin={{ top: 12, right: 26, bottom: 16, left: 18 }}><defs><linearGradient id="objectiveFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0969da" stopOpacity={.3} /><stop offset="100%" stopColor="#0969da" stopOpacity={.02} /></linearGradient></defs><CartesianGrid stroke="#d8dee4" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="parameter" tickLine={false} axisLine={false} tickFormatter={(value) => Number(value).toFixed(2)} tick={{ fill: "#57606a", fontSize: 11 }} tickMargin={12} height={44} minTickGap={30} interval="preserveStartEnd" padding={{ left: 22, right: 22 }} /><YAxis tickLine={false} axisLine={false} tickFormatter={(value) => Number(value).toFixed(2)} tick={{ fill: "#57606a", fontSize: 11 }} tickMargin={12} width={78} tickCount={6} domain={["auto", "auto"]} /><Tooltip formatter={(value) => [Number(value).toFixed(2), "Objective"]} labelFormatter={(value) => `${sensitivity.parameter}: ${Number(value).toFixed(2)}`} cursor={{ stroke: "#8c959f", strokeDasharray: "4 4" }} contentStyle={{ borderRadius: 8, borderColor: "#d0d7de", boxShadow: "0 8px 24px rgba(140,149,159,.2)" }} /><Area type="monotone" dataKey="objective" stroke="#0969da" strokeWidth={3} fill="url(#objectiveFill)" dot={{ r: 3, fill: "#fff", stroke: "#0969da", strokeWidth: 2 }} activeDot={{ r: 5, fill: "#0969da", stroke: "#fff", strokeWidth: 2 }} /></AreaChart></ResponsiveContainer></div><div className="chart-legend"><span><i className="legend-line" /> Objective value</span><span>X: {sensitivity.parameter}</span><span>Y: objective</span></div></section>}{sensitivity && <TemporalComparison baseline={sensitivity.baseline} scenarios={sensitivity.scenarios} selected={(detail ?? best ?? sensitivity.scenarios[0]) as ScenarioResult} parameter={sensitivity.parameter} />}{sensitivity && <section className="github-panel scenario-table"><div className="panel-header"><div><h2>Scenario runs</h2><p>Select a row to inspect its complete variables and duals</p></div><span className="table-badge"><TableIcon /> {sensitivity.scenarios.length} runs</span></div><div className="table-scroll"><table><thead><tr><th>Run</th><th>{sensitivity.parameter}</th><th>Objective</th><th>Improvement</th><th>Time</th><th>Status</th><th /></tr></thead><tbody>{rows.map((item) => { const rowImprovement = baselineObjective !== null && baselineObjective !== undefined && item.objective !== null ? (sense === "minimize" ? baselineObjective - item.objective : item.objective - baselineObjective) : null; return <tr key={item.index} className={detail?.index === item.index ? "active-row" : ""} onClick={() => setDetail(item)}><td><strong>Scenario {String(item.index).padStart(2, "0")}</strong></td><td><code>{item.parameter.toFixed(2)}</code></td><td>{formatNumber(item.objective)}</td><td className={rowImprovement !== null && rowImprovement > 0 ? "positive" : ""}>{rowImprovement === null ? "—" : `${rowImprovement >= 0 ? "+" : ""}${formatNumber(rowImprovement)}`}</td><td>{item.elapsed_ms.toFixed(2)} ms</td><td><Label variant={item.status.toLowerCase() === "optimal" ? "success" : "attention"}>{item.status}</Label></td><td><ChevronRightIcon /></td></tr> })}</tbody></table></div><div className="table-footer"><span>Page {page} of {pageCount}</span><Pagination pageCount={pageCount} currentPage={page} onPageChange={(_event, next) => setPage(next)} showPages /></div></section>}<SolutionDetail result={current} title={detail ? `Scenario ${String(detail.index).padStart(2, "0")}` : sensitivity ? "Best scenario" : "Single run"} /></div>
}

type TemporalView = "value" | "delta" | "percent"
type TemporalAggregation = "value" | "mean"
type TemporalScenario = ScenarioResult | ParetoScenario
const TEMPORAL_RELATIVE_TOLERANCE = 1e-8

function normalizedTemporalDelta(value: number, base: number) {
  const delta = value - base
  const scale = Math.max(1, Math.abs(value), Math.abs(base))
  return Math.abs(delta) <= TEMPORAL_RELATIVE_TOLERANCE * scale ? 0 : delta
}

function formatTemporalNumber(value: number, unit = "") {
  const normalized = Object.is(value, -0) || Math.abs(value) < 1e-12 ? 0 : value
  return `${normalized.toFixed(2)}${unit}`
}

type TemporalChartDatum = {
  period: string | number
  baseline: number | null
  selected: number | null
  range: [number, number] | null
  rangeMin: number | null
  rangeMax: number | null
  availableScenarios: number
  totalScenarios: number
}

function TemporalComparison({ baseline, scenarios, selected, parameter }: { baseline: SolveResult; scenarios: TemporalScenario[]; selected: TemporalScenario | null; parameter: string }) {
  const [metricName, setMetricName] = useState("")
  const [view, setView] = useState<TemporalView>("value")
  const [aggregation, setAggregation] = useState<TemporalAggregation>("value")
  const [showEnvelope, setShowEnvelope] = useState(true)
  const candidates = baseline.time_series ?? []
  if (!candidates.length || !selected) return null

  const keyOf = (series: TimeSeries) => series.series_key ?? series.name
  const metric = candidates.find((candidate) => keyOf(candidate) === metricName) ?? candidates[0]
  const effectiveAggregation: TemporalAggregation = metric.collapsed_dimensions.length ? aggregation : "value"
  const getSeries = (result: SolveResult) => result.time_series?.find((series) => keyOf(series) === keyOf(metric))
  const readPoint = (result: SolveResult, period: string | number) => {
    const point = getSeries(result)?.points.find((item) => String(item.period) === String(period))
    return point?.[effectiveAggregation] ?? null
  }
  const transform = (value: number | null, base: number | null) => {
    if (value === null || base === null) return null
    if (view === "value") return value
    const delta = normalizedTemporalDelta(value, base)
    if (view === "delta") return delta
    return Math.abs(base) < TEMPORAL_RELATIVE_TOLERANCE ? null : (delta / Math.abs(base)) * 100
  }
  const chartData: TemporalChartDatum[] = metric.points.map((basePoint) => {
    const base = basePoint[effectiveAggregation]
    const scenarioValues = scenarios
      .map((scenario) => transform(readPoint(scenario, basePoint.period), base))
      .filter((value): value is number => value !== null)
    const selectedValue = transform(readPoint(selected, basePoint.period), base)
    const range: [number, number] | null = scenarioValues.length
      ? [Math.min(...scenarioValues), Math.max(...scenarioValues)]
      : null
    return {
      period: basePoint.period,
      baseline: view === "value" ? base : base === null ? null : 0,
      selected: selectedValue,
      range,
      rangeMin: range?.[0] ?? null,
      rangeMax: range?.[1] ?? null,
      availableScenarios: scenarioValues.length,
      totalScenarios: scenarios.length,
    }
  })
  const selectedValues = chartData.map((point) => point.selected).filter((value): value is number => value !== null)
  const peakDeviation = selectedValues.length && view !== "value"
    ? Math.max(...selectedValues.map((value) => Math.abs(value)))
    : null
  const viewLabel = view === "value" ? "Value" : view === "delta" ? "Absolute Δ" : "Deviation %"
  const unit = view === "percent" ? "%" : ""
  const selectedLabel = `Scenario ${String(selected.index).padStart(2, "0")} · ${parameter} ${selected.parameter.toFixed(2)}`
  const collapsed = metric.collapsed_dimensions.length
    ? `${effectiveAggregation === "value" ? "Summed" : "Averaged"} across ${metric.collapsed_dimensions.join(" × ")}`
    : Object.keys(metric.selection ?? {}).length ? "Exact indexed trajectory" : "No dimensions collapsed"
  const coverageCounts = chartData.map((point) => point.availableScenarios)
  const coverageMin = coverageCounts.length ? Math.min(...coverageCounts) : 0
  const coverageMax = coverageCounts.length ? Math.max(...coverageCounts) : 0
  const coverageLabel = coverageMin === coverageMax
    ? `${coverageMin}/${scenarios.length} scenarios with values`
    : `${coverageMin}–${coverageMax}/${scenarios.length} scenarios with values per period`
  const incompleteCoverage = coverageMin < scenarios.length
  const hasMaterialVariation = metric.points.some((basePoint) => {
    const base = basePoint[effectiveAggregation]
    if (base === null) return false
    return scenarios.some((scenario) => {
      const value = readPoint(scenario, basePoint.period)
      return value !== null && normalizedTemporalDelta(value, base) !== 0
    })
  })
  const noMaterialVariation = coverageMax > 0 && !hasMaterialVariation
  const chooseMetric = (seriesKey: string) => {
    setMetricName(seriesKey)
    const nextMetric = candidates.find((candidate) => keyOf(candidate) === seriesKey)
    if (nextMetric && !nextMetric.collapsed_dimensions.length) setAggregation("value")
  }
  const metricOptions = candidates.map((candidate) => ({
    value: keyOf(candidate),
    label: candidate.display_name ?? candidate.name,
    description: candidate.collapsed_dimensions.length ? `${candidate.kind} · aggregate` : `${candidate.kind} · indexed`,
  }))

  return <section className="github-panel chart-panel temporal-panel">
    <div className="panel-header temporal-header">
      <div><h2>Time-series comparison</h2><p>Base trajectory, selected scenario, and the solved sensitivity envelope by {metric.time_set}</p></div>
      <Label variant="accent"><PulseIcon /> Temporal analysis</Label>
    </div>
    <div className="temporal-controls">
      <label><span>Output series</span><PrimerMenuSelect ariaLabel="Output series" value={keyOf(metric)} options={metricOptions} onChange={chooseMetric} /></label>
      <label><span>Aggregation</span><PrimerMenuSelect ariaLabel="Aggregation" value={effectiveAggregation} options={metric.collapsed_dimensions.length ? [{ value: "value", label: "Sum", description: `Across ${metric.collapsed_dimensions.join(" × ")}` }, { value: "mean", label: "Mean", description: `Across ${metric.collapsed_dimensions.join(" × ")}` }] : [{ value: "value", label: "Value", description: "Exact indexed trajectory" }]} onChange={(value) => setAggregation(value as TemporalAggregation)} /></label>
      <div className="temporal-view-control"><span>Display</span><div>{(["value", "delta", "percent"] as TemporalView[]).map((mode) => <button key={mode} className={view === mode ? "active" : ""} onClick={() => setView(mode)}>{mode === "value" ? "Values" : mode === "delta" ? "Δ" : "Δ%"}</button>)}</div></div>
      <div className="temporal-context"><span>Selected scenario</span><strong>{selectedLabel}</strong><small>{collapsed}</small></div>
    </div>
    {incompleteCoverage && <div className="temporal-coverage-warning"><span>!</span><p><strong>Partial scenario coverage</strong>{coverageLabel}. Infeasible or unsolved scenarios are excluded from the envelope and shown as gaps.</p></div>}
    {noMaterialVariation && <div className="temporal-stability-note"><CheckCircleFillIcon size={15} /><p><strong>No material variation.</strong> All solved scenarios match the base trajectory within solver tolerance for this output.</p></div>}
    <div className="chart-area temporal-chart-area">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 20, right: 34, bottom: 20, left: 28 }}>
          <CartesianGrid stroke="#d8dee4" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="period" tickLine={false} axisLine={false} tick={{ fill: "#57606a", fontSize: 11 }} tickMargin={12} padding={{ left: 24, right: 24 }} />
          <YAxis tickLine={false} axisLine={false} domain={noMaterialVariation && view !== "value" ? [-1, 1] : ["auto", "auto"]} ticks={noMaterialVariation && view !== "value" ? [0] : undefined} tickFormatter={(value) => formatTemporalNumber(Number(value), unit)} tick={{ fill: "#57606a", fontSize: 11 }} tickMargin={12} width={86} />
          <Tooltip cursor={{ stroke: "#8c959f", strokeDasharray: "4 4" }} content={<TemporalChartTooltip timeSet={metric.time_set} selectedLabel={selectedLabel} viewLabel={viewLabel} unit={unit} />} />
          {showEnvelope && !noMaterialVariation && <Area type="linear" dataKey="range" stroke="none" fill="#8250df" fillOpacity={.12} connectNulls={false} isAnimationActive={false} />}
          {showEnvelope && !noMaterialVariation && <Line type="linear" dataKey="rangeMin" stroke="#8250df" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} connectNulls={false} />}
          {showEnvelope && !noMaterialVariation && <Line type="linear" dataKey="rangeMax" stroke="#8250df" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={false} connectNulls={false} />}
          <Line type="linear" dataKey="baseline" stroke="#24292f" strokeWidth={2.5} strokeDasharray={view === "value" ? undefined : "5 4"} dot={{ r: 3, fill: "#fff", stroke: "#24292f", strokeWidth: 2 }} activeDot={<HybridActiveDot color="#24292f" />} connectNulls={false} />
          <Line type="linear" dataKey="selected" stroke="#0969da" strokeWidth={3} dot={{ r: 4, fill: "#fff", stroke: "#0969da", strokeWidth: 2 }} activeDot={<HybridActiveDot color="#0969da" />} connectNulls={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
    <div className="chart-legend temporal-legend">
      <span><i className="legend-line baseline-line" /> Base model</span>
      <span><i className="legend-line" /> Selected scenario</span>
      <button className={`temporal-envelope-toggle ${showEnvelope ? "active" : ""}`} onClick={() => setShowEnvelope((visible) => !visible)} aria-pressed={showEnvelope}><i className="legend-band" /> Envelope {showEnvelope ? "on" : "off"}</button>
      <span className={incompleteCoverage ? "coverage-incomplete" : ""}>{coverageLabel}{showEnvelope && !noMaterialVariation ? " · bounds may overlap plotted lines" : ""}</span>
      <span>{viewLabel}{peakDeviation !== null ? ` · peak |Δ| ${formatTemporalNumber(peakDeviation, unit)}` : ""}</span>
    </div>
  </section>
}

function TemporalChartTooltip({ active, payload, timeSet, selectedLabel, viewLabel, unit }: { active?: boolean; payload?: ReadonlyArray<{ payload?: TemporalChartDatum }>; timeSet: string; selectedLabel: string; viewLabel: string; unit: string }) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return <div className="pareto-tooltip temporal-tooltip"><div><span>{viewLabel}</span><strong>{timeSet} {point.period}</strong></div><dl><dt>Base model</dt><dd>{point.baseline === null ? "—" : formatTemporalNumber(point.baseline, unit)}</dd><dt>Selected scenario</dt><dd>{point.selected === null ? "—" : formatTemporalNumber(point.selected, unit)}</dd><dt>Scenario envelope</dt><dd>{point.range ? `${formatTemporalNumber(point.range[0], unit)} – ${formatTemporalNumber(point.range[1], unit)}` : "No solved value"}</dd><dt>Coverage</dt><dd>{point.availableScenarios}/{point.totalScenarios} scenarios</dd></dl><p>{selectedLabel}</p></div>
}

function Metric({ icon, label, value, accent }: { icon: ReactNode; label: string; value: string; accent: string }) { return <article className={`hero-metric ${accent}`}><div className="metric-icon">{icon}</div><div><span>{label}</span><strong>{value}</strong></div></article> }

function SolutionDetail({ result, title }: { result: SolveResult; title: string }) { return <section className="detail-section"><div className="detail-heading"><div><Label variant="accent">DETAILED RESULT</Label><h2>{title}</h2></div><span>{result.is_mip ? "MILP · duals unavailable" : "LP · dual values available"}</span></div><div className="detail-columns"><ResultTable title="Decision variables" icon={<CodeIcon />} columns={["Variable", "Value"]} rows={result.variables.map((item) => [item.name, formatNumber(item.value)])} /><ResultTable title="Constraints & duals" icon={<GraphIcon />} columns={["Constraint", "Activity", "Dual"]} rows={result.constraints.map((item) => [item.name, formatNumber(item.activity), result.is_mip ? "—" : formatNumber(item.dual)])} /></div></section> }

function ResultTable({ title, icon, columns, rows }: { title: string; icon: ReactNode; columns: string[]; rows: string[][] }) { return <section className="github-panel detail-table"><div className="panel-header"><h3>{icon}{title}</h3><span>{rows.length} rows</span></div><div className="table-scroll"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={`${row[0]}-${index}`}>{index === 0 ? <code>{cell}</code> : cell}</td>)}</tr>)}</tbody></table></div></section> }

function EmptyResults({ goParameters }: { goParameters: () => void }) { return <div className="empty-results"><div className="empty-visual"><GraphIcon size={32} /></div><h2>No solver results yet</h2><p>Run the base model or lock a parameter range and execute a scenario sweep.</p><Button variant="primary" onClick={goParameters}>Go to parameters</Button></div> }

function formatNumber(value: number | null) { return value === null ? "—" : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function suggestedSweepRange(value: number): SweepRange {
  const magnitude = Math.max(Math.abs(value), 10)
  return { start: round(value - magnitude * 0.4), end: round(value + magnitude * 0.4), step: round(magnitude * 0.1) }
}

function round(value: number) { return Math.round(value * 1000) / 1000 }
