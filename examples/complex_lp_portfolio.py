import pyomo.environ as pyo


# A richer continuous LP with five products and several interacting limits.
model = pyo.ConcreteModel()

products = ["alpha", "beta", "gamma", "delta", "epsilon"]
margin = {"alpha": 42, "beta": 51, "gamma": 63, "delta": 74, "epsilon": 88}
labor = {"alpha": 2.0, "beta": 2.8, "gamma": 3.4, "delta": 4.1, "epsilon": 5.0}
machine = {"alpha": 1.8, "beta": 2.1, "gamma": 2.9, "delta": 3.3, "epsilon": 4.2}
material = {"alpha": 3.5, "beta": 3.0, "gamma": 4.2, "delta": 4.8, "epsilon": 5.4}
energy = {"alpha": 1.0, "beta": 1.3, "gamma": 1.8, "delta": 2.2, "epsilon": 2.8}
market_cap = {"alpha": 80, "beta": 75, "gamma": 60, "delta": 52, "epsilon": 40}

model.x = pyo.Var(products, domain=pyo.NonNegativeReals)

# These scalar mutable parameters are available for single runs or sweeps.
model.labor_limit = pyo.Param(initialize=720.0, mutable=True)
model.machine_limit = pyo.Param(initialize=500.0, mutable=True)
model.material_limit = pyo.Param(initialize=900.0, mutable=True)
model.total_market_limit = pyo.Param(initialize=260.0, mutable=True)
model.energy_cost = pyo.Param(initialize=2.5, mutable=True)

model.net_margin = pyo.Objective(
    expr=sum(
        (margin[p] - model.energy_cost * energy[p]) * model.x[p]
        for p in products
    ),
    sense=pyo.maximize,
)

model.labor_capacity = pyo.Constraint(
    expr=sum(labor[p] * model.x[p] for p in products) <= model.labor_limit
)
model.machine_capacity = pyo.Constraint(
    expr=sum(machine[p] * model.x[p] for p in products) <= model.machine_limit
)
model.material_capacity = pyo.Constraint(
    expr=sum(material[p] * model.x[p] for p in products) <= model.material_limit
)
model.total_market = pyo.Constraint(
    expr=sum(model.x[p] for p in products) <= model.total_market_limit
)
model.premium_commitment = pyo.Constraint(
    expr=model.x["delta"] + model.x["epsilon"] >= 25
)
model.portfolio_balance = pyo.Constraint(
    expr=model.x["alpha"] + model.x["beta"]
    <= 1.8 * (model.x["gamma"] + model.x["delta"] + model.x["epsilon"])
)
model.alpha_contract = pyo.Constraint(expr=model.x["alpha"] >= 12)
model.product_market = pyo.Constraint(
    products,
    rule=lambda m, p: m.x[p] <= market_cap[p],
)

