export const sampleModel = `from pyomo.environ import *

model = ConcreteModel()
model.capacity = Param(initialize=80, mutable=True)
model.demand = Param(initialize=60, mutable=True)

model.x = Var(domain=NonNegativeReals)
model.y = Var(domain=NonNegativeReals)

model.capacity_limit = Constraint(expr=model.x + model.y <= model.capacity)
model.demand_requirement = Constraint(expr=2 * model.x + model.y >= model.demand)
model.cost = Objective(expr=3 * model.x + 5 * model.y, sense=minimize)
`
