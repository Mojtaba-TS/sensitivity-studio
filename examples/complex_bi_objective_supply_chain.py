from pyomo.environ import (
    Binary,
    ConcreteModel,
    Constraint,
    NonNegativeReals,
    Objective,
    Param,
    RangeSet,
    Set,
    Var,
    minimize,
)

model = ConcreteModel()

# Dimensions
model.PLANTS = Set(initialize=["North", "South"])
model.PRODUCTS = Set(initialize=["Standard", "Premium"])
model.PERIODS = RangeSet(1, 4)

# Mutable scalar parameters discovered by Sensitivity Studio.
model.demand_scale = Param(initialize=1.0, mutable=True)
model.overtime_limit = Param(initialize=24.0, mutable=True)
model.backlog_penalty = Param(initialize=48.0, mutable=True)

# Base demand by product and period.
base_demand_data = {
    ("Standard", 1): 62,
    ("Standard", 2): 74,
    ("Standard", 3): 68,
    ("Standard", 4): 82,
    ("Premium", 1): 34,
    ("Premium", 2): 42,
    ("Premium", 3): 48,
    ("Premium", 4): 44,
}
model.base_demand = Param(
    model.PRODUCTS,
    model.PERIODS,
    initialize=base_demand_data,
)

# North is cheaper but dirtier. South is cleaner but more expensive.
production_cost_data = {
    ("North", "Standard"): 17,
    ("North", "Premium"): 23,
    ("South", "Standard"): 24,
    ("South", "Premium"): 31,
}
model.production_cost = Param(
    model.PLANTS,
    model.PRODUCTS,
    initialize=production_cost_data,
)

transport_cost_data = {
    ("North", "Standard"): 3.0,
    ("North", "Premium"): 3.8,
    ("South", "Standard"): 4.2,
    ("South", "Premium"): 4.8,
}
model.transport_cost = Param(
    model.PLANTS,
    model.PRODUCTS,
    initialize=transport_cost_data,
)

model.regular_capacity = Param(
    model.PLANTS,
    initialize={"North": 84, "South": 70},
)
model.emission_factor = Param(
    model.PLANTS,
    initialize={"North": 1.05, "South": 0.28},
)
model.overtime_unit_cost = Param(
    model.PLANTS,
    initialize={"North": 15, "South": 19},
)
model.overtime_fixed_cost = Param(
    model.PLANTS,
    initialize={"North": 320, "South": 410},
)

model.holding_cost = Param(
    model.PRODUCTS,
    initialize={"Standard": 2.2, "Premium": 3.1},
)
model.initial_inventory = Param(
    model.PRODUCTS,
    initialize={"Standard": 12, "Premium": 7},
)

# Decisions
model.production = Var(
    model.PLANTS,
    model.PRODUCTS,
    model.PERIODS,
    domain=NonNegativeReals,
)
model.overtime = Var(
    model.PLANTS,
    model.PERIODS,
    domain=NonNegativeReals,
)
model.use_overtime = Var(
    model.PLANTS,
    model.PERIODS,
    domain=Binary,
)
model.inventory = Var(
    model.PRODUCTS,
    model.PERIODS,
    domain=NonNegativeReals,
)
model.backlog = Var(
    model.PRODUCTS,
    model.PERIODS,
    domain=NonNegativeReals,
)


def capacity_rule(m, plant, period):
    return (
        sum(m.production[plant, product, period] for product in m.PRODUCTS)
        <= m.regular_capacity[plant] + m.overtime[plant, period]
    )


model.capacity_limit = Constraint(
    model.PLANTS,
    model.PERIODS,
    rule=capacity_rule,
)


def overtime_activation_rule(m, plant, period):
    return (
        m.overtime[plant, period]
        <= m.overtime_limit * m.use_overtime[plant, period]
    )


model.overtime_activation = Constraint(
    model.PLANTS,
    model.PERIODS,
    rule=overtime_activation_rule,
)


def flow_balance_rule(m, product, period):
    previous_inventory = (
        m.initial_inventory[product]
        if period == 1
        else m.inventory[product, period - 1]
    )
    previous_backlog = (
        0
        if period == 1
        else m.backlog[product, period - 1]
    )
    supply = sum(
        m.production[plant, product, period]
        for plant in m.PLANTS
    )
    demand = m.demand_scale * m.base_demand[product, period]
    return (
        previous_inventory
        + supply
        + m.backlog[product, period]
        == demand
        + previous_backlog
        + m.inventory[product, period]
    )


model.flow_balance = Constraint(
    model.PRODUCTS,
    model.PERIODS,
    rule=flow_balance_rule,
)


def terminal_backlog_rule(m, product):
    return m.backlog[product, 4] == 0


model.clear_terminal_backlog = Constraint(
    model.PRODUCTS,
    rule=terminal_backlog_rule,
)

# Objective 1: operating economics.
model.economic_cost = Objective(
    expr=
    sum(
        (
            model.production_cost[plant, product]
            + model.transport_cost[plant, product]
        )
        * model.production[plant, product, period]
        for plant in model.PLANTS
        for product in model.PRODUCTS
        for period in model.PERIODS
    )
    + sum(
        model.overtime_unit_cost[plant]
        * model.overtime[plant, period]
        + model.overtime_fixed_cost[plant]
        * model.use_overtime[plant, period]
        for plant in model.PLANTS
        for period in model.PERIODS
    )
    + sum(
        model.holding_cost[product]
        * model.inventory[product, period]
        + model.backlog_penalty
        * model.backlog[product, period]
        for product in model.PRODUCTS
        for period in model.PERIODS
    ),
    sense=minimize,
)

# Objective 2: environmental performance.
model.carbon_emissions = Objective(
    expr=sum(
        model.emission_factor[plant]
        * model.production[plant, product, period]
        for plant in model.PLANTS
        for product in model.PRODUCTS
        for period in model.PERIODS
    )
    + sum(
        0.18
        * model.overtime[plant, period]
        for plant in model.PLANTS
        for period in model.PERIODS
    ),
    sense=minimize,
)
