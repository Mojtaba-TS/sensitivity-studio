import unittest

import pyomo.environ as pyo

from main import SensitivityRequest, is_time_set, sensitivity_impl, time_series_metadata


class TimeSeriesMetadataTests(unittest.TestCase):
    def test_time_names_match_complete_tokens(self) -> None:
        for name in ("T", "PERIODS", "planning_years", "STAGES", "SEASONS", "MY_HORIZON"):
            with self.subTest(name=name):
                self.assertTrue(is_time_set(name))

        for name in ("CANDIDATES", "UPDATE_TYPES", "PRODUCTS", "TECHNOLOGIES"):
            with self.subTest(name=name):
                self.assertFalse(is_time_set(name))

    def test_sum_mean_and_observation_count_match_component_values(self) -> None:
        model = pyo.ConcreteModel()
        model.TECH = pyo.Set(initialize=["wind", "solar"])
        model.PERIODS = pyo.RangeSet(1, 2)
        model.generation = pyo.Var(model.TECH, model.PERIODS)
        model.generation["wind", 1].set_value(10)
        model.generation["solar", 1].set_value(20)
        model.generation["wind", 2].set_value(30)
        model.generation["solar", 2].set_value(50)

        series = time_series_metadata(model)

        self.assertEqual(len(series), 1)
        self.assertEqual(series[0]["collapsed_dimensions"], ["TECH"])
        self.assertEqual(series[0]["time_detection"], "automatic")
        self.assertEqual(
            series[0]["points"],
            [
                {"period": 1, "value": 30.0, "mean": 15.0, "observation_count": 2},
                {"period": 2, "value": 80.0, "mean": 40.0, "observation_count": 2},
            ],
        )

    def test_explicit_time_set_supports_domain_specific_names(self) -> None:
        model = pyo.ConcreteModel()
        model.SCENARIOS = pyo.Set(initialize=["base", "high"])
        model.MY_AXIS = pyo.RangeSet(1, 2)
        model.sensitivity_time_set = "MY_AXIS"
        model.flow = pyo.Var(model.SCENARIOS, model.MY_AXIS, initialize=1)

        series = time_series_metadata(model)

        self.assertEqual(len(series), 1)
        self.assertEqual(series[0]["time_set"], "MY_AXIS")
        self.assertEqual(series[0]["time_detection"], "explicit")

    def test_non_time_candidate_set_is_not_charted(self) -> None:
        model = pyo.ConcreteModel()
        model.CANDIDATES = pyo.Set(initialize=["a", "b"])
        model.choice = pyo.Var(model.CANDIDATES, initialize=1)

        self.assertEqual(time_series_metadata(model), [])

    def test_infeasible_scenario_has_no_temporal_values(self) -> None:
        code = """import pyomo.environ as pyo
model = pyo.ConcreteModel()
model.PERIODS = pyo.RangeSet(1, 2)
model.demand = pyo.Param(initialize=1.0, mutable=True)
model.x = pyo.Var(model.PERIODS, domain=pyo.NonNegativeReals)
model.need = pyo.Constraint(model.PERIODS, rule=lambda m, t: m.x[t] >= m.demand)
model.cap = pyo.Constraint(model.PERIODS, rule=lambda m, t: m.x[t] <= 5)
model.cost = pyo.Objective(expr=sum(model.x[t] for t in model.PERIODS))
"""
        result = sensitivity_impl(
            SensitivityRequest(
                code=code,
                parameters={},
                parameter="demand",
                start=1,
                end=7,
                step=3,
            )
        )

        self.assertEqual([scenario["status"] for scenario in result["scenarios"]], ["optimal", "optimal", "infeasible"])
        self.assertEqual(result["scenarios"][-1]["time_series"], [])


if __name__ == "__main__":
    unittest.main()
