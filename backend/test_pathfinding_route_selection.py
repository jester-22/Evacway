import unittest
from types import SimpleNamespace

from services.pathfinding import select_closest_alternative_center, select_route_candidates


def candidate(center_id, distance_meters):
    return {
        "evacuation_center": {"id": center_id},
        "walking_distance_meters": distance_meters,
    }


class RouteCandidateSelectionTests(unittest.TestCase):
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
