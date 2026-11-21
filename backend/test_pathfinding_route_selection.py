import unittest
from types import SimpleNamespace

from services.pathfinding import (
    choose_safe_route,
    select_closest_alternative_center,
    select_route_candidates,
)


def candidate(center_id, distance_meters):
    return {
        "evacuation_center": {"id": center_id},
        "walking_distance_meters": distance_meters,
    }


def safe_candidate(center_id, name, distance_meters, family_slots, people_spaces):
    return {
        "evacuation_center": {
            "id": center_id,
            "name": name,
            "free_family_slots": family_slots,
            "free_people_spaces": people_spaces,
        },
        "walking_distance_meters": distance_meters,
    }


class RouteCandidateSelectionTests(unittest.TestCase):
    def test_seeded_unreachable_assigned_center_uses_nearest_safe_route(self):
        seeded_routes = [
            safe_candidate(2, "Near Full", 300, 0, 12),
            safe_candidate(3, "Nearest Safe", 500, 4, 18),
            safe_candidate(4, "Farther Safe", 900, 7, 24),
        ]

        selected, state, assigned = choose_safe_route(seeded_routes, assigned_center_id=1)

        self.assertEqual(state, "fallback")
        self.assertEqual(selected["evacuation_center"]["name"], "Nearest Safe")
        self.assertEqual(selected["evacuation_center"]["free_people_spaces"], 18)
        self.assertIsNone(assigned)

    def test_seeded_no_safe_center_returns_rescue_state(self):
        seeded_routes = [
            safe_candidate(1, "Assigned Full", 300, 0, 12),
            safe_candidate(2, "Other Full", 500, 4, 0),
        ]

        selected, state, assigned = choose_safe_route(seeded_routes, assigned_center_id=1)

        self.assertIsNone(selected)
        self.assertEqual(state, "no_safe_center")
        self.assertEqual(assigned["evacuation_center"]["name"], "Assigned Full")

    def test_seeded_reachable_assigned_center_stays_selected_without_fallback(self):
        seeded_routes = [
            safe_candidate(1, "Assigned Safe", 700, 2, 8),
            safe_candidate(2, "Closer Safe", 300, 3, 10),
        ]

        selected, state, assigned = choose_safe_route(seeded_routes, assigned_center_id=1)

        self.assertEqual(state, "assigned")
        self.assertEqual(selected["evacuation_center"]["name"], "Assigned Safe")
        self.assertIsNone(assigned)

    def test_selected_destination_uses_nearest_other_mapped_center_by_straight_line(self):
        centers = [
            (SimpleNamespace(id=2), 1.8),
            (SimpleNamespace(id=3), 0.6),
            (SimpleNamespace(id=4), 1.2),
        ]

        alternative = select_closest_alternative_center(centers)

        self.assertEqual(alternative.id, 3)
        self.assertIsNone(select_closest_alternative_center([]))

    def test_nearest_reachable_center_is_selected_with_next_shortest_alternative(self):
        primary, alternative = select_route_candidates([
            candidate(1, 900),
            candidate(2, 450),
            candidate(3, 700),
        ])

        self.assertEqual(primary["evacuation_center"]["id"], 2)
        self.assertEqual(alternative["evacuation_center"]["id"], 3)

    def test_selected_center_stays_primary_and_alternative_uses_next_closest_other_center(self):
        primary, alternative = select_route_candidates([
            candidate(1, 900),
            candidate(2, 450),
            candidate(3, 700),
        ], preferred_center_id=1)

        self.assertEqual(primary["evacuation_center"]["id"], 1)
        self.assertEqual(alternative["evacuation_center"]["id"], 2)

    def test_missing_preferred_center_has_no_primary_and_returns_nearest_alternative(self):
        primary, alternative = select_route_candidates([
            candidate(2, 450),
            candidate(3, 700),
        ], preferred_center_id=1)

        self.assertIsNone(primary)
        self.assertEqual(alternative["evacuation_center"]["id"], 2)


if __name__ == "__main__":
    unittest.main()
