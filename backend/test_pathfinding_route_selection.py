import unittest
from types import SimpleNamespace

from unittest.mock import patch
import networkx as nx
from shapely.geometry import LineString
from shapely.strtree import STRtree

from services.pathfinding import (
    calculate_route_with_edge_snapping,
    choose_safe_route,
    describe_fallback_reason,
    select_closest_alternative_center,
    select_route_candidates,
    snap_point_to_road,
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

    def test_fallback_reason_distinguishes_unreachable_no_capacity_and_full(self):
        self.assertEqual(describe_fallback_reason(None), "unreachable")
        reachable = safe_candidate(46, "SLSU", 300, 0, 0)
        self.assertEqual(
            describe_fallback_reason(reachable, {"total_people_spaces": 0}),
            "no_capacity",
        )
        self.assertEqual(
            describe_fallback_reason(reachable, {"total_people_spaces": 50}),
            "full",
        )

    def test_snap_point_to_road_does_not_overshoot_entrance_to_nearby_vertex(self):
        # Road runs south-to-north along lng=124.9800 from lat=10.3900 to 10.3910 (and continues to 10.3920)
        u = (10.3900, 124.9800)
        v = (10.3910, 124.9800)
        w = (10.3920, 124.9800)
        G = nx.Graph()
        G.add_edge(u, v, weight=0.111, base_weight=1.0, is_closed=False)
        G.add_edge(v, w, weight=0.111, base_weight=1.0, is_closed=False)

        sub1 = {
            "u": u,
            "v": v,
            "sub_line": LineString([(u[1], u[0]), (v[1], v[0])]),
            "seg_id": 1,
            "road_name": "Main St",
            "base_weight": 1.0,
            "is_closed": False,
        }
        sub2 = {
            "u": v,
            "v": w,
            "sub_line": LineString([(v[1], v[0]), (w[1], w[0])]),
            "seg_id": 1,
            "road_name": "Main St",
            "base_weight": 1.0,
            "is_closed": False,
        }
        fake_net = {
            "graph": G,
            "sub_segments": [sub1, sub2],
            "sub_lines": [sub1["sub_line"], sub2["sub_line"]],
            "spatial_tree": STRtree([sub1["sub_line"], sub2["sub_line"]]),
            "largest_cc": {u, v, w},
        }

        # Entrance is 10m before vertex v (lat=10.39091, slightly east of the road at lng=124.98005)
        with patch("services.pathfinding.get_road_network", return_value=fake_net):
            snapped_pt, _, _, _ = snap_point_to_road(10.39091, 124.98005)
            # Must snap to lat=10.39091 on the road edge, NOT yank 10m past the entrance to vertex v (10.3910)
            self.assertAlmostEqual(snapped_pt[0], 10.39091, places=5)
            self.assertAlmostEqual(snapped_pt[1], 124.9800, places=5)

    def test_snap_point_to_road_prefers_segment_aligned_with_user_heading(self):
        # Main road runs North-South (bearing 0/180) along lng=124.9800
        u_ns, v_ns = (10.3900, 124.9800), (10.3920, 124.9800)
        # Side alley branches East-West (bearing 90/270) at lat=10.3910
        u_ew, v_ew = (10.3910, 124.9800), (10.3910, 124.9820)
        G = nx.Graph()
        G.add_edge(u_ns, v_ns, weight=0.222, base_weight=1.0, is_closed=False)
        G.add_edge(u_ew, v_ew, weight=0.222, base_weight=1.0, is_closed=False)

        sub_ns = {
            "u": u_ns,
            "v": v_ns,
            "sub_line": LineString([(u_ns[1], u_ns[0]), (v_ns[1], v_ns[0])]),
            "seg_id": 1,
            "road_name": "North-South Ave",
            "base_weight": 1.0,
            "is_closed": False,
        }
        sub_ew = {
            "u": u_ew,
            "v": v_ew,
            "sub_line": LineString([(u_ew[1], u_ew[0]), (v_ew[1], v_ew[0])]),
            "seg_id": 2,
            "road_name": "Side Alley",
            "base_weight": 1.0,
            "is_closed": False,
        }
        fake_net = {
            "graph": G,
            "sub_segments": [sub_ns, sub_ew],
            "sub_lines": [sub_ns["sub_line"], sub_ew["sub_line"]],
            "spatial_tree": STRtree([sub_ns["sub_line"], sub_ew["sub_line"]]),
            "largest_cc": {u_ns, v_ns, u_ew, v_ew},
        }

        # User is near the corner, slightly closer to the East-West alley (lat=10.39098, lng=124.98006)
        # but walking due North (heading=0)
        with patch("services.pathfinding.get_road_network", return_value=fake_net):
            _, _, matched_sub, _ = snap_point_to_road(10.39098, 124.98006, heading=0.0)
            self.assertEqual(matched_sub["road_name"], "North-South Ave")


if __name__ == "__main__":
    unittest.main()
