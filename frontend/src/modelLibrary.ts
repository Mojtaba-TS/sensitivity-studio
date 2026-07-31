export type SampleModel = {
  id: string
  title: string
  category: "LP" | "MILP" | "BI-OBJECTIVE"
  description: string
  capabilities: string[]
  code: string
}

export const modelLibrary: SampleModel[] = [
  {
    id: "production-portfolio-lp",
    title: "Production portfolio",
    category: "LP",
    description: "Five-product allocation with interacting labor, machine, material, market, and energy limits.",
    capabilities: ["Continuous LP", "Dual values", "Single sweep"],
    code: String.raw`import pyomo.environ as pyo

model = pyo.ConcreteModel()
model.PRODUCTS = pyo.Set(initialize=["alpha", "beta", "gamma", "delta", "epsilon"])

margin = {"alpha": 42, "beta": 51, "gamma": 63, "delta": 74, "epsilon": 88}
labor = {"alpha": 2.0, "beta": 2.8, "gamma": 3.4, "delta": 4.1, "epsilon": 5.0}
machine = {"alpha": 1.8, "beta": 2.1, "gamma": 2.9, "delta": 3.3, "epsilon": 4.2}
material = {"alpha": 3.5, "beta": 3.0, "gamma": 4.2, "delta": 4.8, "epsilon": 5.4}
energy = {"alpha": 1.0, "beta": 1.3, "gamma": 1.8, "delta": 2.2, "epsilon": 2.8}
market = {"alpha": 80, "beta": 75, "gamma": 60, "delta": 52, "epsilon": 40}

model.labor_limit = pyo.Param(initialize=720.0, mutable=True)
model.machine_limit = pyo.Param(initialize=500.0, mutable=True)
model.material_limit = pyo.Param(initialize=900.0, mutable=True)
model.total_market_limit = pyo.Param(initialize=260.0, mutable=True)
model.energy_cost = pyo.Param(initialize=2.5, mutable=True)

model.production = pyo.Var(model.PRODUCTS, domain=pyo.NonNegativeReals)

model.net_margin = pyo.Objective(
    expr=sum((margin[p] - model.energy_cost * energy[p]) * model.production[p]
             for p in model.PRODUCTS),
    sense=pyo.maximize,
)
model.labor_capacity = pyo.Constraint(
    expr=sum(labor[p] * model.production[p] for p in model.PRODUCTS) <= model.labor_limit
)
model.machine_capacity = pyo.Constraint(
    expr=sum(machine[p] * model.production[p] for p in model.PRODUCTS) <= model.machine_limit
)
model.material_capacity = pyo.Constraint(
    expr=sum(material[p] * model.production[p] for p in model.PRODUCTS) <= model.material_limit
)
model.total_market = pyo.Constraint(
    expr=sum(model.production[p] for p in model.PRODUCTS) <= model.total_market_limit
)
model.premium_commitment = pyo.Constraint(
    expr=model.production["delta"] + model.production["epsilon"] >= 25
)
model.portfolio_balance = pyo.Constraint(
    expr=model.production["alpha"] + model.production["beta"]
    <= 1.8 * sum(model.production[p] for p in ["gamma", "delta", "epsilon"])
)
model.product_market = pyo.Constraint(
    model.PRODUCTS, rule=lambda m, p: m.production[p] <= market[p]
)
`,
  },
  {
    id: "factory-planning-milp",
    title: "Factory planning",
    category: "MILP",
    description: "Multi-period production, setup decisions, overtime, inventory, and demand fulfillment.",
    capabilities: ["Binary setup", "Time series", "Indexed variables"],
    code: String.raw`import pyomo.environ as pyo

model = pyo.ConcreteModel()
model.PRODUCTS = pyo.Set(initialize=["standard", "premium", "industrial"])
model.PERIODS = pyo.RangeSet(1, 6)

base_demand = {
    ("standard", 1): 48, ("standard", 2): 52, ("standard", 3): 60,
    ("standard", 4): 58, ("standard", 5): 65, ("standard", 6): 70,
    ("premium", 1): 28, ("premium", 2): 32, ("premium", 3): 30,
    ("premium", 4): 38, ("premium", 5): 42, ("premium", 6): 45,
    ("industrial", 1): 18, ("industrial", 2): 22, ("industrial", 3): 26,
    ("industrial", 4): 24, ("industrial", 5): 30, ("industrial", 6): 34,
}
unit_cost = {"standard": 21, "premium": 32, "industrial": 39}
setup_cost = {"standard": 260, "premium": 340, "industrial": 410}
hours = {"standard": 1.0, "premium": 1.4, "industrial": 1.8}
holding = {"standard": 1.8, "premium": 2.5, "industrial": 3.2}

model.demand_scale = pyo.Param(initialize=1.0, mutable=True)
model.regular_hours = pyo.Param(initialize=180.0, mutable=True)
model.overtime_limit = pyo.Param(initialize=45.0, mutable=True)
model.overtime_cost = pyo.Param(initialize=18.0, mutable=True)

model.production = pyo.Var(model.PRODUCTS, model.PERIODS, domain=pyo.NonNegativeIntegers)
model.inventory = pyo.Var(model.PRODUCTS, model.PERIODS, domain=pyo.NonNegativeReals)
model.setup = pyo.Var(model.PRODUCTS, model.PERIODS, domain=pyo.Binary)
model.overtime = pyo.Var(model.PERIODS, domain=pyo.NonNegativeReals)

def inventory_rule(m, product, period):
    previous = 10 if period == 1 else m.inventory[product, period - 1]
    return previous + m.production[product, period] == (
        m.demand_scale * base_demand[product, period] + m.inventory[product, period]
    )
model.inventory_balance = pyo.Constraint(model.PRODUCTS, model.PERIODS, rule=inventory_rule)

model.capacity = pyo.Constraint(
    model.PERIODS,
    rule=lambda m, t: sum(hours[p] * m.production[p, t] for p in m.PRODUCTS)
    <= m.regular_hours + m.overtime[t],
)
model.overtime_cap = pyo.Constraint(
    model.PERIODS, rule=lambda m, t: m.overtime[t] <= m.overtime_limit
)
model.setup_link = pyo.Constraint(
    model.PRODUCTS, model.PERIODS,
    rule=lambda m, p, t: m.production[p, t] <= 160 * m.setup[p, t],
)
model.final_inventory = pyo.Constraint(
    model.PRODUCTS, rule=lambda m, p: m.inventory[p, 6] >= 8
)

model.total_cost = pyo.Objective(
    expr=sum(unit_cost[p] * model.production[p, t]
             + setup_cost[p] * model.setup[p, t]
             + holding[p] * model.inventory[p, t]
             for p in model.PRODUCTS for t in model.PERIODS)
    + sum(model.overtime_cost * model.overtime[t] for t in model.PERIODS),
    sense=pyo.minimize,
)
`,
  },
  {
    id: "facility-location-milp",
    title: "Facility location network",
    category: "MILP",
    description: "Choose distribution centers and route customer demand through a capacitated logistics network.",
    capabilities: ["Facility binaries", "Network flows", "Demand sweep"],
    code: String.raw`import pyomo.environ as pyo

model = pyo.ConcreteModel()
model.FACILITIES = pyo.Set(initialize=["north", "central", "south", "coastal"])
model.CUSTOMERS = pyo.Set(initialize=["A", "B", "C", "D", "E", "F"])

capacity = {"north": 150, "central": 190, "south": 170, "coastal": 130}
fixed_cost = {"north": 4200, "central": 5100, "south": 4700, "coastal": 3900}
demand = {"A": 52, "B": 68, "C": 44, "D": 74, "E": 58, "F": 46}
shipping = {
    ("north", "A"): 4, ("north", "B"): 6, ("north", "C"): 9, ("north", "D"): 12, ("north", "E"): 13, ("north", "F"): 15,
    ("central", "A"): 7, ("central", "B"): 4, ("central", "C"): 5, ("central", "D"): 7, ("central", "E"): 9, ("central", "F"): 10,
    ("south", "A"): 13, ("south", "B"): 11, ("south", "C"): 8, ("south", "D"): 5, ("south", "E"): 4, ("south", "F"): 6,
    ("coastal", "A"): 11, ("coastal", "B"): 9, ("coastal", "C"): 7, ("coastal", "D"): 8, ("coastal", "E"): 5, ("coastal", "F"): 3,
}

model.demand_scale = pyo.Param(initialize=1.0, mutable=True)
model.capacity_scale = pyo.Param(initialize=1.0, mutable=True)
model.fixed_cost_scale = pyo.Param(initialize=1.0, mutable=True)
model.maximum_facilities = pyo.Param(initialize=3.0, mutable=True)

model.open = pyo.Var(model.FACILITIES, domain=pyo.Binary)
model.shipment = pyo.Var(model.FACILITIES, model.CUSTOMERS, domain=pyo.NonNegativeReals)

model.serve_demand = pyo.Constraint(
    model.CUSTOMERS,
    rule=lambda m, c: sum(m.shipment[f, c] for f in m.FACILITIES)
    == m.demand_scale * demand[c],
)
model.facility_capacity = pyo.Constraint(
    model.FACILITIES,
    rule=lambda m, f: sum(m.shipment[f, c] for c in m.CUSTOMERS)
    <= m.capacity_scale * capacity[f] * m.open[f],
)
model.open_limit = pyo.Constraint(
    expr=sum(model.open[f] for f in model.FACILITIES) <= model.maximum_facilities
)
model.regional_resilience = pyo.Constraint(
    expr=model.open["north"] + model.open["central"] >= 1
)

model.network_cost = pyo.Objective(
    expr=model.fixed_cost_scale * sum(fixed_cost[f] * model.open[f] for f in model.FACILITIES)
    + sum(shipping[f, c] * model.shipment[f, c]
          for f in model.FACILITIES for c in model.CUSTOMERS),
    sense=pyo.minimize,
)
`,
  },
  {
    id: "supply-chain-bi",
    title: "Supply chain: cost vs carbon",
    category: "BI-OBJECTIVE",
    description: "Four-period production network balancing operating cost against carbon emissions.",
    capabilities: ["Pareto frontier", "Hybrid sweep", "Time series"],
    code: String.raw`from pyomo.environ import *

model = ConcreteModel()
model.PLANTS = Set(initialize=["North", "South"])
model.PRODUCTS = Set(initialize=["Standard", "Premium"])
model.PERIODS = RangeSet(1, 4)

model.demand_scale = Param(initialize=1.0, mutable=True)
model.overtime_limit = Param(initialize=24.0, mutable=True)
model.backlog_penalty = Param(initialize=48.0, mutable=True)

base_demand = {
    ("Standard", 1): 62, ("Standard", 2): 74, ("Standard", 3): 68, ("Standard", 4): 82,
    ("Premium", 1): 34, ("Premium", 2): 42, ("Premium", 3): 48, ("Premium", 4): 44,
}
production_cost = {
    ("North", "Standard"): 17, ("North", "Premium"): 23,
    ("South", "Standard"): 24, ("South", "Premium"): 31,
}
transport_cost = {
    ("North", "Standard"): 3.0, ("North", "Premium"): 3.8,
    ("South", "Standard"): 4.2, ("South", "Premium"): 4.8,
}
regular_capacity = {"North": 84, "South": 70}
emission_factor = {"North": 1.05, "South": 0.28}
overtime_cost = {"North": 15, "South": 19}
fixed_overtime = {"North": 320, "South": 410}
holding_cost = {"Standard": 2.2, "Premium": 3.1}
initial_inventory = {"Standard": 12, "Premium": 7}

model.production = Var(model.PLANTS, model.PRODUCTS, model.PERIODS, domain=NonNegativeReals)
model.overtime = Var(model.PLANTS, model.PERIODS, domain=NonNegativeReals)
model.use_overtime = Var(model.PLANTS, model.PERIODS, domain=Binary)
model.inventory = Var(model.PRODUCTS, model.PERIODS, domain=NonNegativeReals)
model.backlog = Var(model.PRODUCTS, model.PERIODS, domain=NonNegativeReals)

model.capacity = Constraint(
    model.PLANTS, model.PERIODS,
    rule=lambda m, f, t: sum(m.production[f, p, t] for p in m.PRODUCTS)
    <= regular_capacity[f] + m.overtime[f, t],
)
model.overtime_activation = Constraint(
    model.PLANTS, model.PERIODS,
    rule=lambda m, f, t: m.overtime[f, t] <= m.overtime_limit * m.use_overtime[f, t],
)

def balance_rule(m, product, period):
    inventory_before = initial_inventory[product] if period == 1 else m.inventory[product, period - 1]
    backlog_before = 0 if period == 1 else m.backlog[product, period - 1]
    return inventory_before + sum(m.production[f, product, period] for f in m.PLANTS) + m.backlog[product, period] == (
        m.demand_scale * base_demand[product, period] + backlog_before + m.inventory[product, period]
    )
model.flow_balance = Constraint(model.PRODUCTS, model.PERIODS, rule=balance_rule)
model.clear_backlog = Constraint(model.PRODUCTS, rule=lambda m, p: m.backlog[p, 4] == 0)

model.economic_cost = Objective(
    expr=sum((production_cost[f, p] + transport_cost[f, p]) * model.production[f, p, t]
             for f in model.PLANTS for p in model.PRODUCTS for t in model.PERIODS)
    + sum(overtime_cost[f] * model.overtime[f, t] + fixed_overtime[f] * model.use_overtime[f, t]
          for f in model.PLANTS for t in model.PERIODS)
    + sum(holding_cost[p] * model.inventory[p, t] + model.backlog_penalty * model.backlog[p, t]
          for p in model.PRODUCTS for t in model.PERIODS),
    sense=minimize,
)
model.carbon_emissions = Objective(
    expr=sum(emission_factor[f] * model.production[f, p, t]
             for f in model.PLANTS for p in model.PRODUCTS for t in model.PERIODS)
    + sum(0.18 * model.overtime[f, t] for f in model.PLANTS for t in model.PERIODS),
    sense=minimize,
)
`,
  },
  {
    id: "energy-transition-bi",
    title: "Energy transition planning",
    category: "BI-OBJECTIVE",
    description: "Investment and dispatch planning that trades total system cost against lifecycle emissions.",
    capabilities: ["Continuous Pareto", "Investment planning", "Time series"],
    code: String.raw`import pyomo.environ as pyo

model = pyo.ConcreteModel()
model.TECH = pyo.Set(initialize=["coal", "gas", "wind", "solar"])
model.PERIODS = pyo.RangeSet(1, 6)

demand = {1: 150, 2: 172, 3: 188, 4: 205, 5: 194, 6: 166}
existing = {"coal": 95, "gas": 70, "wind": 38, "solar": 24}
variable_cost = {"coal": 31, "gas": 48, "wind": 7, "solar": 5}
investment_cost = {"coal": 180, "gas": 150, "wind": 235, "solar": 205}
emissions = {"coal": 0.95, "gas": 0.42, "wind": 0.03, "solar": 0.02}
availability = {
    ("coal", 1): .90, ("coal", 2): .90, ("coal", 3): .88, ("coal", 4): .88, ("coal", 5): .90, ("coal", 6): .90,
    ("gas", 1): .95, ("gas", 2): .95, ("gas", 3): .95, ("gas", 4): .95, ("gas", 5): .95, ("gas", 6): .95,
    ("wind", 1): .42, ("wind", 2): .50, ("wind", 3): .58, ("wind", 4): .46, ("wind", 5): .38, ("wind", 6): .55,
    ("solar", 1): .28, ("solar", 2): .52, ("solar", 3): .76, ("solar", 4): .82, ("solar", 5): .48, ("solar", 6): .18,
}

model.demand_scale = pyo.Param(initialize=1.0, mutable=True)
model.gas_price_scale = pyo.Param(initialize=1.0, mutable=True)
model.renewable_cost_scale = pyo.Param(initialize=1.0, mutable=True)
model.reserve_margin = pyo.Param(initialize=0.08, mutable=True)

model.investment = pyo.Var(model.TECH, domain=pyo.NonNegativeReals)
model.generation = pyo.Var(model.TECH, model.PERIODS, domain=pyo.NonNegativeReals)

model.energy_balance = pyo.Constraint(
    model.PERIODS,
    rule=lambda m, t: sum(m.generation[g, t] for g in m.TECH)
    >= m.demand_scale * demand[t] * (1 + m.reserve_margin),
)
model.available_generation = pyo.Constraint(
    model.TECH, model.PERIODS,
    rule=lambda m, g, t: m.generation[g, t]
    <= availability[g, t] * (existing[g] + m.investment[g]),
)
model.renewable_build_limit = pyo.Constraint(
    expr=model.investment["wind"] + model.investment["solar"] <= 280
)

def adjusted_variable_cost(m, technology):
    return variable_cost[technology] * (m.gas_price_scale if technology == "gas" else 1)

def adjusted_investment_cost(m, technology):
    return investment_cost[technology] * (
        m.renewable_cost_scale if technology in {"wind", "solar"} else 1
    )

model.total_system_cost = pyo.Objective(
    expr=sum(adjusted_investment_cost(model, g) * model.investment[g] for g in model.TECH)
    + sum(adjusted_variable_cost(model, g) * model.generation[g, t]
          for g in model.TECH for t in model.PERIODS),
    sense=pyo.minimize,
)
model.lifecycle_emissions = pyo.Objective(
    expr=sum(emissions[g] * model.generation[g, t]
             for g in model.TECH for t in model.PERIODS)
    + 0.01 * sum(model.investment[g] for g in model.TECH),
    sense=pyo.minimize,
)
`,
  },
]

export const defaultSampleModel = modelLibrary[0].code
