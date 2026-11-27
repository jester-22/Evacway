import unittest
from types import SimpleNamespace

from unittest.mock import patch
import networkx as nx
from shapely.geometry import LineString
from shapely.strtree import STRtree

from services.pathfinding import (
    assess_user_start_access,
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

    def _build_trapped_test_network(self):
        # Open main highway along north: lat=10.3910, lng=124.9800 -> 124.9830
        o1 = (10.3910, 124.9800)
        o2 = (10.3910, 124.9815)
        o3 = (10.3910, 124.9830)
        # Disconnected small open cul-de-sac to the south-east: lat=10.3895, lng=124.9820 -> 124.9825
        iso1 = (10.3895, 124.9820)
        iso2 = (10.3895, 124.9825)

        G = nx.Graph()
        G.add_edge(o1, o2, weight=0.166, base_weight=1.0, is_closed=False)
        G.add_edge(o2, o3, weight=0.166, base_weight=1.0, is_closed=False)
        G.add_edge(iso1, iso2, weight=0.055, base_weight=1.0, is_closed=False)

        open_subs = [
            {
                "u": o1, "v": o2,
                "sub_line": LineString([(o1[1], o1[0]), (o2[1], o2[0])]),
                "seg_id": 1, "road_name": "North Highway", "base_weight": 1.0, "is_closed": False,
            },
            {
                "u": o2, "v": o3,
                "sub_line": LineString([(o2[1], o2[0]), (o3[1], o3[0])]),
                "seg_id": 2, "road_name": "North Highway East", "base_weight": 1.0, "is_closed": False,
            },
            {
                "u": iso1, "v": iso2,
                "sub_line": LineString([(iso1[1], iso1[0]), (iso2[1], iso2[0])]),
                "seg_id": 3, "road_name": "Isolated Alley", "base_weight": 1.0, "is_closed": False,
            },
        ]
        open_lines = [s["sub_line"] for s in open_subs]

        # Closed flooded roads boxing in the south side:
        # 1) South horizontal flooded road at lat=10.3900, lng=124.9800 -> 124.9815
        # 2) Vertical flooded connector at lng=124.9815, lat=10.3900 -> 10.3910 (meets o2)
        # 3) Horizontal flooded barrier separating north highway from south block at lat=10.3905, lng=124.9800 -> 124.9815
        closed_lines = [
            LineString([(124.9800, 10.3900), (124.9815, 10.3900)]),
            LineString([(124.9815, 10.3900), (124.9815, 10.3910)]),
            LineString([(124.9800, 10.3905), (124.9815, 10.3905)]),
        ]
        closed_segments = [
            {"sub_line": closed_lines[0], "seg_id": 10, "road_name": "Flooded South St"},
            {"sub_line": closed_lines[1], "seg_id": 11, "road_name": "Flooded Connector"},
            {"sub_line": closed_lines[2], "seg_id": 12, "road_name": "Flooded Mid Barrier"},
        ]

        return {
            "graph": G,
            "sub_segments": open_subs,
            "sub_lines": open_lines,
            "spatial_tree": STRtree(open_lines),
            "closed_lines": closed_lines,
            "closed_segments": closed_segments,
            "closed_spatial_tree": STRtree(closed_lines),
            "largest_cc": {o1, o2, o3},
        }

    def test_user_standing_on_closed_flooded_road_is_trapped_and_not_routed(self):
        fake_net = self._build_trapped_test_network()
        with patch("services.pathfinding.get_road_network", return_value=fake_net):
            # User right on Flooded South St (~110m south of North Highway)
            access = assess_user_start_access(10.39001, 124.9808)
            self.assertTrue(access["trapped"])
            self.assertEqual(access["reason"], "on_closed_road")

            route = calculate_route_with_edge_snapping(10.39001, 124.9808, 10.3910, 124.9828)
            self.assertIsNone(route)

    def test_user_separated_from_open_road_by_closed_road_is_trapped(self):
        fake_net = self._build_trapped_test_network()
        with patch("services.pathfinding.get_road_network", return_value=fake_net):
            # User in middle of residential block (lat=10.39025, lng=124.9807):
            # walking north to North Highway crosses Flooded Mid Barrier (lat=10.3905)
            access = assess_user_start_access(10.39025, 124.9807)
            self.assertTrue(access["trapped"])
            self.assertIn(access["reason"], {"surrounded_by_closed_roads", "blocked_access_road"})

            route = calculate_route_with_edge_snapping(10.39025, 124.9807, 10.3910, 124.9828)
            self.assertIsNone(route)

    def test_user_on_disconnected_open_road_island_does_not_jump_to_main_network(self):
        fake_net = self._build_trapped_test_network()
        with patch("services.pathfinding.get_road_network", return_value=fake_net):
            # User standing right on Isolated Alley (disconnected from North Highway)
            access = assess_user_start_access(10.38951, 124.9822)
            self.assertFalse(access["trapped"])
            self.assertIsNotNone(access["snap"])
            self.assertFalse(access["snap"][3])  # is_connected == False (stayed on isolated alley)
            self.assertEqual(access["snap"][2]["road_name"], "Isolated Alley")

            # Cannot reach a center on North Highway
            route = calculate_route_with_edge_snapping(10.38951, 124.9822, 10.3910, 124.9828)
            self.assertIsNone(route)

    def test_user_on_open_road_near_closed_junction_still_routes_safely(self):
        fake_net = self._build_trapped_test_network()
        with patch("services.pathfinding.get_road_network", return_value=fake_net):
            # User standing right on North Highway near the junction o2 with Flooded Connector
            access = assess_user_start_access(10.39102, 124.98155)
            self.assertFalse(access["trapped"])
            route = calculate_route_with_edge_snapping(10.39102, 124.98155, 10.3910, 124.9828)
            self.assertIsNotNone(route)
            self.assertGreater(route["road_distance_meters"], 50.0)

    def test_off_road_user_with_no_closed_roads_nearby_routes_normally(self):
        fake_net = self._build_trapped_test_network()
        with patch("services.pathfinding.get_road_network", return_value=fake_net):
            # User 60m north of North Highway East (no closed roads near them)
            access = assess_user_start_access(10.39154, 124.9824)
            self.assertFalse(access["trapped"])
            route = calculate_route_with_edge_snapping(10.39154, 124.9824, 10.3910, 124.9828)
            self.assertIsNotNone(route)

    def test_off_road_user_40m_from_isolated_pocket_does_not_jump_to_distant_main_road(self):
        fake_net = self._build_trapped_test_network()
        with patch("services.pathfinding.get_road_network", return_value=fake_net):
            # User is ~45m south of Isolated Alley (lat=10.3891, lng=124.9822) —
            # closer to Isolated Alley (~45m) than North Highway (~210m).
            access = assess_user_start_access(10.3891, 124.9822)
            self.assertFalse(access["trapped"])
            self.assertIsNotNone(access["snap"])
            self.assertFalse(access["snap"][3])  # stayed on Isolated Alley, did not leap to North Highway
            self.assertEqual(access["snap"][2]["road_name"], "Isolated Alley")
            route = calculate_route_with_edge_snapping(10.3891, 124.9822, 10.3910, 124.9828)
            self.assertIsNone(route)

    def test_user_whose_only_nearby_access_road_is_closed_at_65m_is_trapped(self):
        fake_net = self._build_trapped_test_network()
        with patch("services.pathfinding.get_road_network", return_value=fake_net):
            # User is ~65m south of Flooded South St (lat=10.3894, lng=124.9806):
            # nearest road is closed (65m), nearest open road is >150m away
            access = assess_user_start_access(10.3894, 124.9806)
            self.assertTrue(access["trapped"])
            self.assertEqual(access["reason"], "blocked_access_road")
            route = calculate_route_with_edge_snapping(10.3894, 124.9806, 10.3910, 124.9828)
            self.assertIsNone(route)


if __name__ == "__main__":
    unittest.main()
