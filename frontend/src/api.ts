export type Parameter = { name: string; value: number }
export type Objective = { name: string; sense: "minimize" | "maximize"; active: boolean }
export type TimeSeriesPoint = { period: string | number; value: number | null; mean: number | null }
export type TimeSeries = {
  name: string
  kind: "variable" | "expression"
  time_set: string
  aggregation: "sum"
  collapsed_dimensions: string[]
  points: TimeSeriesPoint[]
}
export type SolveResult = {
  status: string
  objective: number | null
  objective_name: string | null
  objective_sense: "minimize" | "maximize"
  objective_values: Record<string, number | null>
  is_mip: boolean
  elapsed_ms: number
  variables: { name: string; value: number | null }[]
  constraints: { name: string; activity: number | null; lower: number | null; upper: number | null; dual: number | null }[]
  time_series: TimeSeries[]
}
export type ScenarioResult = SolveResult & { index: number; parameter: number }
export type SensitivityResult = {
  parameter: string
  baseline: SolveResult
  points: { parameter: number; objective: number | null; status: string }[]
  scenarios: ScenarioResult[]
}
export type ParetoPoint = SolveResult & { index: number; position: number; epsilon: number }
export type ParetoResult = {
  method: "epsilon-constraint"
  primary_objective: string
  secondary_objective: string
  objectives: Objective[]
  requested_points: number
  points: ParetoPoint[]
}
export type ParetoScenario = SolveResult & { index: number; parameter: number; position: number; epsilon: number | null }
export type ParetoSensitivityResult = {
  method: "epsilon-constraint"
  parameter: string
  primary_objective: string
  secondary_objective: string
  position: number
  baseline: SolveResult
  points: { parameter: number; primary: number | null; secondary: number | null; status: string }[]
  scenarios: ParetoScenario[]
}

const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "")

async function post<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.detail ?? "Something went wrong")
  return data
}

export const inspectModel = (code: string) => post<{ parameters: Parameter[]; objectives: Objective[] }>("/inspect", { code })
export const solveModel = (code: string, parameters: Record<string, number>) => post<SolveResult>("/solve", { code, parameters })
export const runSensitivity = (code: string, parameters: Record<string, number>, parameter: string, start: number, end: number, step: number) =>
  post<SensitivityResult>("/sensitivity", { code, parameters, parameter, start, end, step })
export const generatePareto = (code: string, parameters: Record<string, number>, primaryObjective: string, secondaryObjective: string, points = 10) =>
  post<ParetoResult>("/pareto", { code, parameters, primary_objective: primaryObjective, secondary_objective: secondaryObjective, points })
export const runParetoSensitivity = (code: string, parameters: Record<string, number>, parameter: string, start: number, end: number, step: number, primaryObjective: string, secondaryObjective: string, position: number) =>
  post<ParetoSensitivityResult>("/pareto-sensitivity", { code, parameters, parameter, start, end, step, primary_objective: primaryObjective, secondary_objective: secondaryObjective, position })
