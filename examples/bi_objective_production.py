from pyomo.environ import (
    ConcreteModel,
    Constraint,
    NonNegativeReals,
    Objective,
    Param,
    Var,
    maximize,
    minimize,
)

model = ConcreteModel()

# Mutable values available to the sensitivity workspace.
model.minimum_output = Param(initialize=40, mutable=True)
model.capacity = Param(initialize=80, mutable=True)

# Standard output is inexpensive; premium output creates more service value.
model.standard = Var(domain=NonNegativeReals)
model.premium = Var(domain=NonNegativeReals)

model.minimum_production = Constraint(
    expr=model.standard + model.premium >= model.minimum_output
)
model.capacity_limit = Constraint(
    expr=model.standard + model.premium <= model.capacity
)

# The two objectives intentionally conflict, creating a Pareto frontier.
model.total_cost = Objective(
    expr=2 * model.standard + 6 * model.premium,
    sense=minimize,
)
model.service_value = Objective(
    expr=2 * model.standard + 5 * model.premium,
    sense=maximize,
)
