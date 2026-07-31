import pyomo.environ as pyo


# Mixed-integer production planning with an optional overtime shift.
model = pyo.ConcreteModel()

model.chairs = pyo.Var(domain=pyo.NonNegativeIntegers)
model.tables = pyo.Var(domain=pyo.NonNegativeIntegers)
model.use_overtime = pyo.Var(domain=pyo.Binary)

# These scalar mutable parameters appear in Sensitivity Studio.
model.labor_limit = pyo.Param(initialize=240.0, mutable=True)
model.material_limit = pyo.Param(initialize=300.0, mutable=True)
model.overtime_cost = pyo.Param(initialize=450.0, mutable=True)

model.profit = pyo.Objective(
    expr=(45 * model.chairs + 80 * model.tables)
    - model.overtime_cost * model.use_overtime,
    sense=pyo.maximize,
)

model.labor = pyo.Constraint(
    expr=2 * model.chairs + 4 * model.tables
    <= model.labor_limit + 80 * model.use_overtime
)
model.material = pyo.Constraint(
    expr=3 * model.chairs + 2 * model.tables <= model.material_limit
)
model.chair_market = pyo.Constraint(expr=model.chairs <= 90)
model.table_market = pyo.Constraint(expr=model.tables <= 60)

