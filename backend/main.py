from __future__ import annotations

import os
import re
from time import perf_counter
from typing import Any

import pyomo.environ as pyo
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from sandbox import run_sandboxed
from security import MAX_CODE_BYTES, validate_model_code


app = FastAPI(title="Pyomo Sensitivity Dashboard")
allowed_origins = [
    origin.strip().rstrip("/")
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


class InspectRequest(BaseModel):
    code: str = Field(min_length=1, max_length=MAX_CODE_BYTES)


class SolveRequest(InspectRequest):
    parameters: dict[str, float] = Field(default_factory=dict)


class SensitivityRequest(SolveRequest):
    parameter: str
    start: float
    end: float
    step: float = Field(gt=0)


class ParetoRequest(SolveRequest):
    primary_objective: str
    secondary_objective: str
    points: int = Field(default=10, ge=2, le=25)


class ParetoSensitivityRequest(SensitivityRequest):
    primary_objective: str
    secondary_objective: str
    position: float = Field(ge=0, le=1)


def load_model(code: str) -> pyo.ConcreteModel:
    validate_model_code(code)
    namespace: dict[str, Any] = {"__name__": "__pyomo_dashboard_model__"}
    try:
        exec(code, namespace)
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"Your Python code failed: {error}") from error

    model = namespace.get("model")
    if not isinstance(model, pyo.ConcreteModel):
        raise HTTPException(
            status_code=422,
            detail="Expected a Pyomo ConcreteModel named 'model' in the pasted code.",
        )
    return model


def parameter_metadata(model: pyo.ConcreteModel) -> list[dict[str, Any]]:
    parameters: list[dict[str, Any]] = []
    for component in model.component_objects(pyo.Param, active=True):
        if not component.mutable:
            continue
        entries = component.values() if component.is_indexed() else (component,)
        for parameter in entries:
            value = pyo.value(parameter, exception=False)
            if isinstance(value, (int, float)):
                parameters.append({"name": parameter.name, "value": float(value)})
    return parameters


def objective_metadata(model: pyo.ConcreteModel) -> list[dict[str, Any]]:
    return [
        {
            "name": objective.name,
            "sense": "minimize" if objective.sense == pyo.minimize else "maximize",
            "active": objective.active,
        }
        for objective in model.component_data_objects(pyo.Objective, active=None)
    ]


def get_objective(model: pyo.ConcreteModel, name: str) -> Any:
    objective = model.find_component(name)
    if objective is None or objective.ctype is not pyo.Objective:
        raise HTTPException(status_code=422, detail=f"Unknown objective: {name}")
    if objective.is_indexed():
        raise HTTPException(status_code=422, detail=f"Indexed objective containers are not supported directly: {name}")
    return objective


def apply_parameters(model: pyo.ConcreteModel, updates: dict[str, float]) -> None:
    editable = {item["name"] for item in parameter_metadata(model)}
    unknown = set(updates) - editable
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown or non-editable parameter: {', '.join(sorted(unknown))}")
    for name, value in updates.items():
        parameter = model.find_component(name)
        if parameter is None:
            raise HTTPException(status_code=422, detail=f"Unknown or non-editable parameter: {name}")
        parameter.set_value(value)


TIME_SET_TOKENS = {
    "t",
    "time",
    "times",
    "period",
    "periods",
    "year",
    "years",
    "quarter",
    "quarters",
    "month",
    "months",
    "week",
    "weeks",
    "day",
    "days",
    "date",
    "dates",
    "hour",
    "hours",
    "stage",
    "stages",
    "season",
    "seasons",
    "horizon",
    "horizons",
}


def name_tokens(name: str) -> list[str]:
    local_name = name.rsplit(".", 1)[-1]
    separated = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", local_name)
    return [token for token in re.split(r"[^a-z0-9]+", separated.lower()) if token]


def is_time_set(name: str) -> bool:
    """Recognize complete time-related name tokens, never arbitrary substrings."""
    return any(token in TIME_SET_TOKENS for token in name_tokens(name))


def explicit_time_set_name(model: pyo.ConcreteModel) -> str | None:
    """Allow models with domain-specific names to declare their time dimension."""
    configured = getattr(model, "sensitivity_time_set", None)
    if configured is None:
        return None
    if isinstance(configured, str):
        return configured
    name = getattr(configured, "name", None)
    return name if isinstance(name, str) else None


def serialize_period(value: Any) -> str | int | float:
    if isinstance(value, (str, int, float)):
        return value
    return str(value)


def temporal_points(periods: list[Any], buckets: dict[Any, list[float]]) -> list[dict[str, Any]]:
    points = []
    for period in periods:
        values = buckets.get(period, [])
        points.append(
            {
                "period": serialize_period(period),
                "value": sum(values) if values else None,
                "mean": sum(values) / len(values) if values else None,
                "observation_count": len(values),
            }
        )
    return points


def time_series_metadata(model: pyo.ConcreteModel) -> list[dict[str, Any]]:
    series: list[dict[str, Any]] = []
    configured_time_set = explicit_time_set_name(model)
    for component_type, kind in ((pyo.Var, "variable"), (pyo.Expression, "expression")):
        for component in model.component_objects(component_type, active=True):
            if not component.is_indexed():
                continue
            dimensions = list(component.index_set().subsets())
            if not dimensions or any(dimension.dimen != 1 for dimension in dimensions):
                continue
            if configured_time_set:
                time_positions = [
                    index for index, dimension in enumerate(dimensions)
                    if dimension.name == configured_time_set
                    or dimension.name.rsplit(".", 1)[-1] == configured_time_set
                ]
            else:
                time_positions = [
                    index for index, dimension in enumerate(dimensions)
                    if is_time_set(dimension.name)
                ]
            if not time_positions:
                continue
            time_position = time_positions[-1]
            time_dimension = dimensions[time_position]
            periods = list(time_dimension)
            buckets: dict[Any, list[float]] = {period: [] for period in periods}
            collapsed_positions = [index for index in range(len(dimensions)) if index != time_position]
            collapsed_dimensions = [dimensions[index].name for index in collapsed_positions]
            slice_buckets: dict[tuple[Any, ...], dict[Any, list[float]]] = {}

            for data in component.values():
                raw_index = data.index()
                index_tuple = raw_index if isinstance(raw_index, tuple) else (raw_index,)
                if time_position >= len(index_tuple):
                    continue
                value = pyo.value(data, exception=False)
                if isinstance(value, (int, float)):
                    period = index_tuple[time_position]
                    buckets.setdefault(period, []).append(float(value))
                    slice_key = tuple(index_tuple[index] for index in collapsed_positions)
                    if slice_key:
                        slice_buckets.setdefault(
                            slice_key,
                            {period_item: [] for period_item in periods},
                        ).setdefault(period, []).append(float(value))

            series.append(
                {
                    "name": component.name,
                    "series_key": component.name,
                    "display_name": component.name,
                    "kind": kind,
                    "time_set": time_dimension.name,
                    "aggregation": "sum",
                    "time_detection": "explicit" if configured_time_set else "automatic",
                    "collapsed_dimensions": collapsed_dimensions,
                    "selection": {},
                    "points": temporal_points(periods, buckets),
                }
            )

            for slice_key, selected_buckets in list(slice_buckets.items())[:200]:
                selection = {
                    dimension_name: serialize_period(index_value)
                    for dimension_name, index_value in zip(collapsed_dimensions, slice_key)
                }
                selection_label = " · ".join(
                    f"{name.rsplit('.', 1)[-1]}={value}"
                    for name, value in selection.items()
                )
                stable_selection = "|".join(f"{name}={value}" for name, value in selection.items())
                series.append(
                    {
                        "name": component.name,
                        "series_key": f"{component.name}::{stable_selection}",
                        "display_name": f"{component.name} · {selection_label}",
                        "kind": kind,
                        "time_set": time_dimension.name,
                        "aggregation": "sum",
                        "time_detection": "explicit" if configured_time_set else "automatic",
                        "collapsed_dimensions": [],
                        "selection": selection,
                        "points": temporal_points(periods, selected_buckets),
                    }
                )
    return series


def solve_loaded_model(
    model: pyo.ConcreteModel,
    started_at: float,
    reported_objectives: list[str] | None = None,
) -> dict[str, Any]:
    is_mip = any(
        variable.is_binary() or variable.is_integer()
        for variable in model.component_data_objects(pyo.Var, active=True)
    )
    if not is_mip and not hasattr(model, "dual"):
        model.dual = pyo.Suffix(direction=pyo.Suffix.IMPORT)

    try:
        # Do not let the solver raise while trying to load a solution for an
        # infeasible scenario. Inspect the result first, then load it only when
        # HiGHS actually returned a solution.
        result = pyo.SolverFactory("highs").solve(
            model,
            tee=False,
            load_solutions=False,
        )
    except Exception as error:
        raise HTTPException(status_code=422, detail=f"HiGHS could not solve this model: {error}") from error

    status = str(result.solver.termination_condition)
    has_solution = len(result.solution) > 0
    if has_solution:
        model.solutions.load_from(result)

    objective = next(model.component_data_objects(pyo.Objective, active=True), None)
    objective_value = (
        pyo.value(objective, exception=False)
        if objective is not None and has_solution
        else None
    )
    objective_sense = "minimize" if objective is not None and objective.sense == pyo.minimize else "maximize"
    objective_values = {
        name: pyo.value(get_objective(model, name).expr, exception=False) if has_solution else None
        for name in (reported_objectives or [])
    }
    variables = [
        {
            "name": variable.name,
            "value": pyo.value(variable, exception=False) if has_solution else None,
        }
        for variable in model.component_data_objects(pyo.Var, active=True)
    ]
    constraints = []
    for constraint in model.component_data_objects(pyo.Constraint, active=True):
        constraints.append(
            {
                "name": constraint.name,
                "activity": pyo.value(constraint.body, exception=False) if has_solution else None,
                "lower": pyo.value(constraint.lower, exception=False) if constraint.has_lb() else None,
                "upper": pyo.value(constraint.upper, exception=False) if constraint.has_ub() else None,
                "dual": None if is_mip or not has_solution else model.dual.get(constraint),
            }
        )

    return {
        "status": status,
        "objective": objective_value,
        "objective_name": objective.name if objective is not None else None,
        "objective_sense": objective_sense,
        "objective_values": objective_values,
        "is_mip": is_mip,
        "elapsed_ms": round((perf_counter() - started_at) * 1000, 2),
        "variables": variables,
        "constraints": constraints,
        "time_series": time_series_metadata(model) if has_solution else [],
    }


def solve_model(code: str, updates: dict[str, float]) -> dict[str, Any]:
    started_at = perf_counter()
    model = load_model(code)
    apply_parameters(model, updates)
    active_objectives = list(model.component_data_objects(pyo.Objective, active=True))
    if len(active_objectives) != 1:
        raise HTTPException(
            status_code=422,
            detail="Single-objective mode requires exactly one active objective. Use Pareto mode when the model defines multiple objectives.",
        )
    return solve_loaded_model(model, started_at)


def solve_multi_point(
    code: str,
    updates: dict[str, float],
    primary_name: str,
    secondary_name: str,
    epsilon: float | None = None,
) -> dict[str, Any]:
    started_at = perf_counter()
    model = load_model(code)
    apply_parameters(model, updates)
    primary = get_objective(model, primary_name)
    secondary = get_objective(model, secondary_name)
    if primary.name == secondary.name:
        raise HTTPException(status_code=422, detail="Choose two different objectives.")

    for objective in model.component_data_objects(pyo.Objective, active=None):
        objective.deactivate()
    primary.activate()

    if epsilon is not None:
        expression = secondary.expr <= epsilon if secondary.sense == pyo.minimize else secondary.expr >= epsilon
        model._sensitivity_epsilon_constraint = pyo.Constraint(expr=expression)

    return solve_loaded_model(model, started_at, [primary.name, secondary.name])


def payoff_bounds(
    code: str,
    updates: dict[str, float],
    primary_name: str,
    secondary_name: str,
) -> tuple[dict[str, Any], dict[str, Any], float, float]:
    primary_anchor = solve_multi_point(code, updates, primary_name, secondary_name)
    secondary_anchor = solve_multi_point(code, updates, secondary_name, primary_name)
    secondary_at_primary = primary_anchor["objective_values"].get(secondary_name)
    secondary_best = secondary_anchor["objective_values"].get(secondary_name)
    if secondary_at_primary is None or secondary_best is None:
        raise HTTPException(status_code=422, detail="Could not calculate the objective payoff bounds.")
    return primary_anchor, secondary_anchor, float(secondary_at_primary), float(secondary_best)


def pareto_point_at_position(
    code: str,
    updates: dict[str, float],
    primary_name: str,
    secondary_name: str,
    position: float,
    allow_infeasible: bool = False,
) -> dict[str, Any]:
    try:
        primary_anchor, _, secondary_worst, secondary_best = payoff_bounds(
            code, updates, primary_name, secondary_name
        )
    except HTTPException as error:
        if not allow_infeasible or error.detail != "Could not calculate the objective payoff bounds.":
            raise
        # A sensitivity range may legitimately cross into an infeasible region.
        # Keep that scenario in the result instead of aborting the entire sweep.
        failed_point = solve_multi_point(
            code, updates, primary_name, secondary_name
        )
        return {"position": position, "epsilon": None, **failed_point}
    if position <= 1e-9:
        point = primary_anchor
        epsilon = secondary_worst
    else:
        epsilon = secondary_worst + position * (secondary_best - secondary_worst)
        point = solve_multi_point(code, updates, primary_name, secondary_name, epsilon)
    return {"position": position, "epsilon": epsilon, **point}


def scenario_values(start: float, end: float, step: float, maximum: int = 100) -> list[float]:
    if end <= start:
        raise HTTPException(status_code=422, detail="Range end must be greater than range start.")
    count = int((end - start) / step) + 1
    if count < 2:
        raise HTTPException(status_code=422, detail="The selected step must produce at least two scenarios.")
    if count > maximum:
        raise HTTPException(
            status_code=422,
            detail=f"This range produces more than {maximum} scenarios. Increase the step size.",
        )
    return [start + index * step for index in range(count)]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def inspect_impl(request: InspectRequest) -> dict[str, Any]:
    model = load_model(request.code)
    return {
        "parameters": parameter_metadata(model),
        "objectives": objective_metadata(model),
    }


def solve_impl(request: SolveRequest) -> dict[str, Any]:
    return solve_model(request.code, request.parameters)


def sensitivity_impl(request: SensitivityRequest) -> dict[str, Any]:
    baseline = solve_model(request.code, request.parameters)
    points = []
    scenarios = []
    for index, value in enumerate(scenario_values(request.start, request.end, request.step)):
        result = solve_model(request.code, {**request.parameters, request.parameter: value})
        points.append({"parameter": value, "objective": result["objective"], "status": result["status"]})
        scenarios.append({"index": index + 1, "parameter": value, **result})
    return {
        "parameter": request.parameter,
        "baseline": baseline,
        "points": points,
        "scenarios": scenarios,
    }


def pareto_impl(request: ParetoRequest) -> dict[str, Any]:
    model = load_model(request.code)
    objectives = objective_metadata(model)
    available = {item["name"] for item in objectives}
    selected = {request.primary_objective, request.secondary_objective}
    if len(selected) != 2 or not selected.issubset(available):
        raise HTTPException(status_code=422, detail="Choose two different objectives discovered in this model.")

    primary = get_objective(model, request.primary_objective)
    secondary = get_objective(model, request.secondary_objective)
    primary_anchor, _, secondary_worst, secondary_best = payoff_bounds(
        request.code,
        request.parameters,
        primary.name,
        secondary.name,
    )

    points = []
    for index in range(request.points):
        position = index / (request.points - 1)
        if index == 0:
            point = {
                "position": position,
                "epsilon": secondary_worst,
                **primary_anchor,
            }
        else:
            epsilon = secondary_worst + position * (secondary_best - secondary_worst)
            point = {
                "position": position,
                "epsilon": epsilon,
                **solve_multi_point(
                    request.code,
                    request.parameters,
                    primary.name,
                    secondary.name,
                    epsilon,
                ),
            }
        points.append({"index": index + 1, **point})

    return {
        "method": "epsilon-constraint",
        "primary_objective": primary.name,
        "secondary_objective": secondary.name,
        "objectives": objectives,
        "requested_points": request.points,
        "points": points,
    }


def pareto_sensitivity_impl(request: ParetoSensitivityRequest) -> dict[str, Any]:
    scenarios = []
    points = []
    baseline = pareto_point_at_position(
        request.code,
        request.parameters,
        request.primary_objective,
        request.secondary_objective,
        request.position,
    )
    values = scenario_values(request.start, request.end, request.step, maximum=30)
    for index, value in enumerate(values):
        result = pareto_point_at_position(
            request.code,
            {**request.parameters, request.parameter: value},
            request.primary_objective,
            request.secondary_objective,
            request.position,
            allow_infeasible=True,
        )
        scenarios.append({"index": index + 1, "parameter": value, **result})
        points.append(
            {
                "parameter": value,
                "primary": result["objective_values"].get(request.primary_objective),
                "secondary": result["objective_values"].get(request.secondary_objective),
                "status": result["status"],
            }
        )
    return {
        "method": "epsilon-constraint",
        "parameter": request.parameter,
        "primary_objective": request.primary_objective,
        "secondary_objective": request.secondary_objective,
        "position": request.position,
        "baseline": baseline,
        "points": points,
        "scenarios": scenarios,
    }


def sandbox_dispatch(operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    operations = {
        "inspect": (InspectRequest, inspect_impl),
        "solve": (SolveRequest, solve_impl),
        "sensitivity": (SensitivityRequest, sensitivity_impl),
        "pareto": (ParetoRequest, pareto_impl),
        "pareto-sensitivity": (ParetoSensitivityRequest, pareto_sensitivity_impl),
    }
    selected = operations.get(operation)
    if selected is None:
        raise HTTPException(status_code=404, detail="Unknown sandbox operation.")
    request_type, handler = selected
    return handler(request_type(**payload))


@app.post("/inspect")
def inspect(request: InspectRequest) -> dict[str, Any]:
    return run_sandboxed("inspect", request.model_dump())


@app.post("/solve")
def solve(request: SolveRequest) -> dict[str, Any]:
    return run_sandboxed("solve", request.model_dump())


@app.post("/sensitivity")
def sensitivity(request: SensitivityRequest) -> dict[str, Any]:
    return run_sandboxed("sensitivity", request.model_dump())


@app.post("/pareto")
def pareto(request: ParetoRequest) -> dict[str, Any]:
    return run_sandboxed("pareto", request.model_dump())


@app.post("/pareto-sensitivity")
def pareto_sensitivity(request: ParetoSensitivityRequest) -> dict[str, Any]:
    return run_sandboxed("pareto-sensitivity", request.model_dump())
