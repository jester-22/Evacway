import math
import logging
import threading
import networkx as nx
from flask import g, has_request_context
from shapely.geometry import Point, LineString
from shapely.prepared import prep
from shapely.strtree import STRtree
from geoalchemy2.shape import to_shape
from sqlalchemy import func
from sqlalchemy.orm import defer, joinedload, selectinload
from models import (
    db,
    Barangay,
    CenterBarangay,
    RoadSegment,
    HazardZone,
    EvacuationCenter,
    EvacuationCenterBuilding,
    EvacuationCenterRoom,
    EvacuationAssignment,
    EvacuationOperation,
    NonRegisteredEvacuee,
)

logger = logging.getLogger(__name__)

CLOSED_ROAD_PENALTY = 1000000
HAZARD_ZONE_HIGH_RISK_PENALTY = 15.0
HAZARD_ZONE_DEFAULT_PENALTY = 8.0
MAX_ENTRANCE_SNAP_DISTANCE_METERS = 25.0
TRAPPED_ON_CLOSED_ROAD_DISTANCE_METERS = 25.0
TRAPPED_MIN_OPEN_ESCAPE_DISTANCE_METERS = 18.0
TRAPPED_ISOLATED_ROAD_SNAP_METERS = 35.0
TRAPPED_BLOCKED_ACCESS_CLOSED_METERS = 100.0
TRAPPED_BLOCKED_ACCESS_OPEN_METERS = 45.0
MAX_CONNECTED_JUMP_OVER_ISOLATED_METERS = 15.0

_cached_network = None
_network_lock = threading.Lock()


def haversine(lat1, lon1, lat2, lon2):
    """Calculates distance in kilometers between two lat/lng coordinates."""
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(max(0.0, min(1.0, a))))


def calculate_bearing(lat1, lon1, lat2, lon2):
    """Calculates initial bearing in degrees [0, 360) from (lat1, lon1) to (lat2, lon2)."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dlambda = math.radians(lon2 - lon1)
    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def smallest_angle_diff(deg1, deg2):
    """Returns the smallest difference between two bearings in degrees [0, 180]."""
    diff = abs((deg1 - deg2) % 360.0)
    return 360.0 - diff if diff > 180.0 else diff


def invalidate_road_network_cache():
    """Call whenever road segments or hazard closures change."""
    global _cached_network
    with _network_lock:
        _cached_network = None
    if has_request_context():
        g.pop("_closed_road_ids", None)


def get_road_network():
    """
    Builds and caches the road network graph and spatial index for fast edge snapping.
    Closed segments are completely excluded from the graph. Open segments that meet
    a closed segment at an intersection remain connected, so traffic can continue
    through the intersection without entering the closed road stretch.
    Automatically detects if closed road segments changed in the database and rebuilds.
    """
    global _cached_network

    closed_ids = g.get("_closed_road_ids") if has_request_context() else None
    if closed_ids is None:
        closed_ids = tuple(
            sorted(
                r.id
                for r in RoadSegment.query.filter_by(is_closed=True)
                .with_entities(RoadSegment.id)
                .all()
            )
        )
        if has_request_context():
            g._closed_road_ids = closed_ids

    cached = _cached_network
    if cached is not None and cached.get("closed_ids") == closed_ids:
        return cached

    with _network_lock:
        cached = _cached_network
        if cached is not None and cached.get("closed_ids") == closed_ids:
            return cached

        G = nx.Graph()
        sub_segments = []
        sub_lines = []

        segments = RoadSegment.query.all()

        # 1. Separate open and closed segments. Closed edges are excluded from routing,
        # while their geometry is kept in a spatial index so trapped users cannot snap
        # across closed/flooded roads onto distant open streets.
        open_segments = []
        closed_lines = []
        closed_segments = []

        for seg in segments:
            if not seg.geom:
                continue
            try:
                line = to_shape(seg.geom)
            except Exception as e:
                logger.warning(f"Failed to parse geometry for road segment {seg.id}: {e}")
                continue

            if not seg.is_closed:
                open_segments.append((seg, line))
            else:
                coords = list(line.coords)
                for i in range(len(coords) - 1):
                    lng1, lat1 = coords[i]
                    lng2, lat2 = coords[i + 1]
                    closed_sub = LineString([(lng1, lat1), (lng2, lat2)])
                    closed_lines.append(closed_sub)
                    closed_segments.append(
                        {
                            "sub_line": closed_sub,
                            "seg_id": seg.id,
                            "road_name": seg.road_name or "Closed Road",
                        }
                    )

        # Load active flood / landslide hazard zone polygons to penalize overlapping road edges
        # cleanly without severing road connectivity when no alternative road exists.
        hazard_raw_polys = []
        hazard_prepared = []
        try:
            zones = HazardZone.query.all()
            for zone in zones:
                if not getattr(zone, "geom", None):
                    continue
                hz_type = str(getattr(zone, "hazard_type", "") or "").strip().lower()
                if hz_type and not any(k in hz_type for k in ("flood", "landslide", "storm", "hazard")):
                    continue
                risk = str(getattr(zone, "risk_level", "") or "").strip().lower()
                multiplier = (
                    HAZARD_ZONE_HIGH_RISK_PENALTY
                    if "high" in risk or "critical" in risk
                    else HAZARD_ZONE_DEFAULT_PENALTY
                )
                hz_poly = to_shape(zone.geom)
                hazard_raw_polys.append(hz_poly)
                hazard_prepared.append((prep(hz_poly), multiplier))
        except Exception:
            hazard_raw_polys = []
            hazard_prepared = []

        hazard_tree = STRtree(hazard_raw_polys) if hazard_raw_polys else None

        # 2. Build graph and spatial index exclusively from open segments
        for seg, line in open_segments:
            coords = list(line.coords)
            for i in range(len(coords) - 1):
                lng1, lat1 = coords[i]
                lng2, lat2 = coords[i + 1]

                u = (round(lat1, 6), round(lng1, 6))
                v = (round(lat2, 6), round(lng2, 6))
                if u == v:
                    continue

                sub_line = LineString([(lng1, lat1), (lng2, lat2)])
                dist_km = haversine(lat1, lng1, lat2, lng2)
                effective_weight_factor = float(seg.base_weight or 1.0)
                if hazard_tree is not None:
                    max_hz_mult = 1.0
                    try:
                        candidate_hz_idxs = hazard_tree.query(sub_line)
                    except Exception:
                        candidate_hz_idxs = range(len(hazard_prepared))
                    for hz_idx in candidate_hz_idxs:
                        try:
                            prep_poly, hz_mult = hazard_prepared[int(hz_idx)]
                            if prep_poly.intersects(sub_line):
                                max_hz_mult = max(max_hz_mult, hz_mult)
                        except Exception:
                            continue
                    effective_weight_factor *= max_hz_mult

                weight = dist_km * effective_weight_factor

                existing = G.get_edge_data(u, v)
                if existing is None or weight < existing.get("weight", float("inf")):
                    G.add_edge(
                        u,
                        v,
                        weight=weight,
                        length_km=dist_km,
                        base_weight=effective_weight_factor,
                        is_closed=False,
                        seg_id=seg.id,
                        road_name=seg.road_name or "Road",
                    )

                sub_lines.append(sub_line)
                sub_segments.append(
                    {
                        "u": u,
                        "v": v,
                        "sub_line": sub_line,
                        "seg_id": seg.id,
                        "road_name": seg.road_name or "Road",
                        "base_weight": effective_weight_factor,
                        "is_closed": False,
                    }
                )

        spatial_tree = STRtree(sub_lines) if sub_lines else None
        closed_spatial_tree = STRtree(closed_lines) if closed_lines else None

        # Identify the largest connected component for connectivity validation
        largest_cc = set()
        if G.number_of_nodes() > 0:
            connected_components = list(nx.connected_components(G))
            if connected_components:
                largest_cc = max(connected_components, key=len)

        _cached_network = {
            "graph": G,
            "sub_segments": sub_segments,
            "sub_lines": sub_lines,
            "spatial_tree": spatial_tree,
            "closed_lines": closed_lines,
            "closed_segments": closed_segments,
            "closed_spatial_tree": closed_spatial_tree,
            "largest_cc": largest_cc,
            "closed_ids": closed_ids,
        }
        return _cached_network


def snap_point_to_road(lat, lng, snap_to_intersection=False, heading=None):
    """
    Projects an arbitrary (lat, lng) point onto the nearest road segment.
    When `heading` (degrees 0-360) is provided, candidate road segments within
    ~45m are evaluated using both perpendicular distance and road-axis alignment
    so the user snaps to the road aligned with their travel direction rather than
    an adjacent perpendicular side alley.
    By default (`snap_to_intersection=False`), returns the exact perpendicular
    projection on the road polyline edge so start/destination endpoints never
    overshoot past an entrance to a distant vertex.
    Returns:
      snapped_point: (lat, lng) on the road segment
      dist_meters: distance from point to snapped_point in meters
      sub_segment: metadata dict of the matched edge
      is_connected: whether this edge belongs to the main walkable network
    """
    net = get_road_network()
    spatial_tree = net["spatial_tree"]
    sub_segments = net["sub_segments"]
    largest_cc = net["largest_cc"]

    if spatial_tree is None or not sub_segments:
        return (lat, lng), 0.0, None, False

    p = Point(lng, lat)
    valid_heading = (
        float(heading) % 360.0
        if heading is not None and isinstance(heading, (int, float)) and math.isfinite(heading)
        else None
    )

    # Gather nearby candidate sub-segments (~45m radius) plus the single nearest segment
    candidate_indices = set()
    try:
        nearby_idxs = spatial_tree.query(p.buffer(0.00042))
        for idx in nearby_idxs:
            candidate_indices.add(int(idx))
    except Exception:
        pass

    nearest_idx = int(spatial_tree.nearest(p))
    candidate_indices.add(nearest_idx)

    best_candidate = None
    for idx in candidate_indices:
        sub = sub_segments[idx]
        proj = sub["sub_line"].project(p)
        snap_geom = sub["sub_line"].interpolate(proj)
        c_lat = round(snap_geom.y, 6)
        c_lng = round(snap_geom.x, 6)
        dist_m = haversine(lat, lng, c_lat, c_lng) * 1000.0

        u, v = sub["u"], sub["v"]
        is_conn = (u in largest_cc) or (v in largest_cc)

        # Strongly prefer segments connected to the main road network
        score = dist_m + (0.0 if is_conn else 5000.0)

        if valid_heading is not None and dist_m <= 35.0 and u != v:
            seg_bearing_fwd = calculate_bearing(u[0], u[1], v[0], v[1])
            seg_bearing_rev = (seg_bearing_fwd + 180.0) % 360.0
            axis_misalignment = min(
                smallest_angle_diff(valid_heading, seg_bearing_fwd),
                smallest_angle_diff(valid_heading, seg_bearing_rev),
            )
            # Penalize perpendicular side streets (up to ~12m penalty at 90 degrees)
            if axis_misalignment > 20.0:
                score += ((axis_misalignment - 20.0) / 70.0) * 12.0

        if best_candidate is None or score < best_candidate[0]:
            best_candidate = (score, (c_lat, c_lng), dist_m, sub, is_conn)

    _, (snap_lat, snap_lng), dist_meters, best_sub, is_connected = best_candidate
    u, v = best_sub["u"], best_sub["v"]

    # Optional true-intersection snapping (only when explicitly requested and degree >= 3)
    G = net.get("graph")
    if snap_to_intersection and G is not None:
        d_u = haversine(snap_lat, snap_lng, u[0], u[1]) * 1000.0
        d_v = haversine(snap_lat, snap_lng, v[0], v[1]) * 1000.0
        if d_u <= 8.0 and d_u <= d_v and G.has_node(u) and G.degree(u) >= 3:
            snap_lat = round(u[0], 6)
            snap_lng = round(u[1], 6)
            dist_meters = haversine(lat, lng, snap_lat, snap_lng) * 1000.0
        elif d_v <= 8.0 and d_v <= d_u and G.has_node(v) and G.degree(v) >= 3:
            snap_lat = round(v[0], 6)
            snap_lng = round(v[1], 6)
            dist_meters = haversine(lat, lng, snap_lat, snap_lng) * 1000.0

    return (snap_lat, snap_lng), dist_meters, best_sub, is_connected


def _access_line_crosses_closed_road(
    start_lat, start_lng, snap_lat, snap_lng, closed_lines, closed_spatial_tree
):
    """
    Returns True if walking straight from (start_lat, start_lng) to (snap_lat, snap_lng)
    crosses or runs along a closed road segment. Trims the final ~3m near the open-road
    snap point so standing on an open street at a junction with a closed street is not
    falsely flagged as crossing the closed street.
    """
    if closed_spatial_tree is None or not closed_lines:
        return False

    dist_m = haversine(start_lat, start_lng, snap_lat, snap_lng) * 1000.0
    if dist_m <= 1.0:
        return False

    # Trim ~3m (capped at 20% of segment length) off the snap endpoint so touching a
    # shared intersection vertex with a closed road doesn't count as crossing it.
    trim_ratio = min(0.20, 3.0 / max(dist_m, 3.0))
    end_lat = start_lat + (snap_lat - start_lat) * (1.0 - trim_ratio)
    end_lng = start_lng + (snap_lng - start_lng) * (1.0 - trim_ratio)
    trimmed_line = LineString([(start_lng, start_lat), (end_lng, end_lat)])

    try:
        # Small ~2m buffer catches standing directly on a closed road polyline despite GPS/rounding jitter
        nearby_closed_idxs = closed_spatial_tree.query(trimmed_line.buffer(0.00002))
    except Exception:
        return False

    for idx in nearby_closed_idxs:
        closed_line = closed_lines[int(idx)]
        try:
            if trimmed_line.intersects(closed_line):
                return True
            # Also reject if the midpoint/start lies right on top of a closed road (~3m)
            if trimmed_line.distance(closed_line) <= 0.000025:
                # Only treat proximity as blocked when it actually gets closer to the closed road
                # than the open road snap distance (avoids flagging an open parallel sidewalk).
                start_pt = Point(start_lng, start_lat)
                c_proj = closed_line.interpolate(closed_line.project(start_pt))
                d_start_closed = haversine(start_lat, start_lng, c_proj.y, c_proj.x) * 1000.0
                if d_start_closed <= 6.0 and d_start_closed + 3.0 < dist_m:
                    return True
        except Exception:
            continue
    return False


def assess_user_start_access(lat, lng, heading=None):
    """
    Evaluates whether a user at (lat, lng) can safely reach an open road without
    crossing closed/flooded roads or jumping across disconnected road pockets.
    Returns a dict:
      trapped: bool
      reason: str | None ('on_closed_road' | 'surrounded_by_closed_roads' | 'blocked_access_road' | 'no_open_roads')
      snap: ((snap_lat, snap_lng), dist_m, sub, is_connected) | None
      nearest_closed_meters: float | None
      nearest_closed_road: str | None
    """
    net = get_road_network()
    spatial_tree = net.get("spatial_tree")
    sub_segments = net.get("sub_segments") or []
    closed_spatial_tree = net.get("closed_spatial_tree")
    closed_lines = net.get("closed_lines") or []
    closed_segments = net.get("closed_segments") or []
    largest_cc = net.get("largest_cc") or set()

    if spatial_tree is None or not sub_segments:
        return {
            "trapped": True,
            "reason": "no_open_roads",
            "snap": None,
            "nearest_closed_meters": None,
            "nearest_closed_road": None,
        }

    p = Point(lng, lat)
    valid_heading = (
        float(heading) % 360.0
        if heading is not None and isinstance(heading, (int, float)) and math.isfinite(heading)
        else None
    )

    nearest_closed_m = None
    nearest_closed_road = None
    if closed_spatial_tree is not None and closed_lines:
        try:
            c_idx = int(closed_spatial_tree.nearest(p))
            c_line = closed_lines[c_idx]
            c_proj = c_line.interpolate(c_line.project(p))
            nearest_closed_m = haversine(lat, lng, c_proj.y, c_proj.x) * 1000.0
            if c_idx < len(closed_segments):
                nearest_closed_road = closed_segments[c_idx].get("road_name")
        except Exception:
            nearest_closed_m = None

    # Gather nearby open road candidates (~120m radius) plus nearest open road
    candidate_indices = set()
    try:
        for idx in spatial_tree.query(p.buffer(0.0011)):
            candidate_indices.add(int(idx))
    except Exception:
        pass
    candidate_indices.add(int(spatial_tree.nearest(p)))

    evaluated = []
    for idx in candidate_indices:
        sub = sub_segments[idx]
        proj = sub["sub_line"].project(p)
        snap_geom = sub["sub_line"].interpolate(proj)
        c_lat = round(snap_geom.y, 6)
        c_lng = round(snap_geom.x, 6)
        dist_m = haversine(lat, lng, c_lat, c_lng) * 1000.0
        u, v = sub["u"], sub["v"]
        is_conn = (u in largest_cc) or (v in largest_cc)
        crosses_closed = _access_line_crosses_closed_road(
            lat, lng, c_lat, c_lng, closed_lines, closed_spatial_tree
        )

        heading_penalty = 0.0
        if valid_heading is not None and dist_m <= 35.0 and u != v:
            seg_bearing_fwd = calculate_bearing(u[0], u[1], v[0], v[1])
            seg_bearing_rev = (seg_bearing_fwd + 180.0) % 360.0
            axis_misalignment = min(
                smallest_angle_diff(valid_heading, seg_bearing_fwd),
                smallest_angle_diff(valid_heading, seg_bearing_rev),
            )
            if axis_misalignment > 20.0:
                heading_penalty = ((axis_misalignment - 20.0) / 70.0) * 12.0

        evaluated.append(
            {
                "snap_pt": (c_lat, c_lng),
                "dist_m": dist_m,
                "score": dist_m + heading_penalty,
                "sub": sub,
                "is_conn": is_conn,
                "crosses_closed": crosses_closed,
            }
        )

    evaluated.sort(key=lambda item: item["dist_m"])
    nearest_open = evaluated[0]

    # 1. Standing directly on/along a closed road with no immediately adjacent open road
    if (
        nearest_closed_m is not None
        and nearest_closed_m <= TRAPPED_ON_CLOSED_ROAD_DISTANCE_METERS
        and nearest_open["dist_m"] > TRAPPED_MIN_OPEN_ESCAPE_DISTANCE_METERS
        and (nearest_closed_m + 5.0) < nearest_open["dist_m"]
    ):
        return {
            "trapped": True,
            "reason": "on_closed_road",
            "snap": None,
            "nearest_closed_meters": round(nearest_closed_m, 1),
            "nearest_closed_road": nearest_closed_road,
        }

    # 2. Filter out open segments whose straight walk crosses a closed road
    unblocked = [item for item in evaluated if not item["crosses_closed"]]
    if not unblocked:
        return {
            "trapped": True,
            "reason": "surrounded_by_closed_roads",
            "snap": None,
            "nearest_closed_meters": round(nearest_closed_m, 1) if nearest_closed_m is not None else None,
            "nearest_closed_road": nearest_closed_road,
        }

    # 3. User's access road is closed while the nearest unblocked open road is far across another block/terrain
    nearest_unblocked = min(unblocked, key=lambda item: item["dist_m"])
    if (
        nearest_closed_m is not None
        and nearest_closed_m <= TRAPPED_BLOCKED_ACCESS_CLOSED_METERS
        and nearest_unblocked["dist_m"] > TRAPPED_BLOCKED_ACCESS_OPEN_METERS
        and nearest_closed_m < nearest_unblocked["dist_m"]
    ):
        return {
            "trapped": True,
            "reason": "blocked_access_road",
            "snap": None,
            "nearest_closed_meters": round(nearest_closed_m, 1),
            "nearest_closed_road": nearest_closed_road,
        }

    # 4. User is physically closer to a disconnected open-road pocket (isolated by closed roads):
    # Do NOT leap across blocks/hazards to a distant open road in largest_cc.
    connected_unblocked = [item for item in unblocked if item["is_conn"]]
    nearest_connected = min(connected_unblocked, key=lambda item: item["dist_m"]) if connected_unblocked else None
    if (
        not nearest_unblocked["is_conn"]
        and (
            nearest_connected is None
            or nearest_connected["dist_m"] > (nearest_unblocked["dist_m"] + MAX_CONNECTED_JUMP_OVER_ISOLATED_METERS)
        )
    ):
        return {
            "trapped": False,
            "reason": None,
            "snap": (
                nearest_unblocked["snap_pt"],
                nearest_unblocked["dist_m"],
                nearest_unblocked["sub"],
                False,
            ),
            "nearest_closed_meters": round(nearest_closed_m, 1) if nearest_closed_m is not None else None,
            "nearest_closed_road": nearest_closed_road,
        }

    # Pick the best unblocked candidate (preferring connected open roads only when within jump tolerance)
    pool = connected_unblocked if connected_unblocked else unblocked
    best = min(pool, key=lambda item: item["score"])
    return {
        "trapped": False,
        "reason": None,
        "snap": (best["snap_pt"], best["dist_m"], best["sub"], best["is_conn"]),
        "nearest_closed_meters": round(nearest_closed_m, 1) if nearest_closed_m is not None else None,
        "nearest_closed_road": nearest_closed_road,
    }


def calculate_route_with_edge_snapping(
    start_lat, start_lng, target_lat, target_lng, heading=None, start_snap=None
):
    """
    Computes a walking route from start to target by snapping BOTH endpoints
    to their exact positions along road segments (not vertices) and running Dijkstra.
    When `heading` is provided, applies bearing-aware snapping and a small directional
    penalty against immediately reversing direction on the starting road segment.
    Returns:
      dict with road path, legs, and distance metrics, or None if no path exists.
    """
    net = get_road_network()
    G_base = net["graph"]
    if G_base.number_of_nodes() == 0:
        return None

    valid_heading = (
        float(heading) % 360.0
        if heading is not None and isinstance(heading, (int, float)) and math.isfinite(heading)
        else None
    )

    if start_snap is not None:
        u_snap, u_dist, u_sub, u_connected = start_snap
    else:
        start_access = assess_user_start_access(start_lat, start_lng, heading=valid_heading)
        if start_access["trapped"] or start_access["snap"] is None:
            return None
        u_snap, u_dist, u_sub, u_connected = start_access["snap"]
    t_snap, t_dist, t_sub, t_connected = snap_point_to_road(
        target_lat, target_lng, snap_to_intersection=False
    )

    if not u_connected or not t_connected:
        logger.warning(
            f"Point disconnected from main road network: start_connected={u_connected}, target_connected={t_connected}"
        )

    # Work on a copy of the graph to insert temporary split nodes
    G = G_base.copy()

    # Case 1: Both snap to the EXACT same road sub-segment
    if u_sub is not None and t_sub is not None and u_sub is t_sub:
        u_node, v_node = u_sub["u"], u_sub["v"]
        if G.has_edge(u_node, v_node):
            G.remove_edge(u_node, v_node)

        # Order u_snap and t_snap along the sub_line
        sub_line = u_sub["sub_line"]
        p_u = sub_line.project(Point(u_snap[1], u_snap[0]))
        p_t = sub_line.project(Point(t_snap[1], t_snap[0]))

        pts = sorted([(p_u, u_snap), (p_t, t_snap)], key=lambda x: x[0])
        first_pt, second_pt = pts[0][1], pts[1][1]

        def add_split_edge(n1, n2):
            if n1 != n2:
                # Never reconnect to absent graph nodes.
                if n1 in (u_node, v_node) and not G_base.has_node(n1):
                    return
                if n2 in (u_node, v_node) and not G_base.has_node(n2):
                    return
                d = haversine(n1[0], n1[1], n2[0], n2[1])
                w = d * (u_sub["base_weight"] or 1.0)
                G.add_edge(n1, n2, weight=w, length_km=d, is_closed=False)

        add_split_edge(u_node, first_pt)
        add_split_edge(first_pt, second_pt)
        add_split_edge(second_pt, v_node)

    else:
        # Case 2: Start and target are on different sub-segments
        for is_start, snap_pt, sub in [(True, u_snap, u_sub), (False, t_snap, t_sub)]:
            if sub is not None and snap_pt != sub["u"] and snap_pt != sub["v"]:
                u_node, v_node = sub["u"], sub["v"]
                if G.has_edge(u_node, v_node):
                    G.remove_edge(u_node, v_node)

                d1 = haversine(u_node[0], u_node[1], snap_pt[0], snap_pt[1])
                w1 = d1 * (sub["base_weight"] or 1.0)

                d2 = haversine(snap_pt[0], snap_pt[1], v_node[0], v_node[1])
                w2 = d2 * (sub["base_weight"] or 1.0)

                # If user heading is known on the start segment, penalize immediate U-turns behind user
                if is_start and valid_heading is not None:
                    bearing_to_u = calculate_bearing(snap_pt[0], snap_pt[1], u_node[0], u_node[1])
                    bearing_to_v = calculate_bearing(snap_pt[0], snap_pt[1], v_node[0], v_node[1])
                    if smallest_angle_diff(valid_heading, bearing_to_u) > 110.0:
                        w1 += 0.06
                    if smallest_angle_diff(valid_heading, bearing_to_v) > 110.0:
                        w2 += 0.06

                # Only connect to u_node/v_node if they exist in G_base (not impassable)
                if G_base.has_node(u_node):
                    G.add_edge(u_node, snap_pt, weight=w1, length_km=d1, is_closed=False)
                if G_base.has_node(v_node):
                    G.add_edge(snap_pt, v_node, weight=w2, length_km=d2, is_closed=False)

    path = None
    road_km = 0.0

    if G.has_node(u_snap) and G.has_node(t_snap):
        try:
            path = nx.dijkstra_path(G, u_snap, t_snap, weight="weight")
            road_km = sum(
                float(
                    (G.get_edge_data(path[i], path[i + 1]) or {}).get(
                        "length_km",
                        haversine(path[i][0], path[i][1], path[i + 1][0], path[i + 1][1]),
                    )
                )
                for i in range(len(path) - 1)
            )
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            path = None

    # If no route exists without going through a blocked road, do not route through blocked roads
    if path is None:
        return None

    road_distance_m = road_km * 1000.0
    start_leg = [[start_lat, start_lng], [u_snap[0], u_snap[1]]]
    final_leg = [[t_snap[0], t_snap[1]], [target_lat, target_lng]]
    total_distance_m = road_distance_m + u_dist + t_dist

    # Format road path as [[lat, lng], ...]
    road_coordinates = [[pt[0], pt[1]] for pt in path]

    return {
        "road_coordinates": road_coordinates,
        "start_leg": start_leg,
        "final_leg": final_leg,
        "road_distance_meters": round(road_distance_m, 1),
        "start_offset_meters": round(u_dist, 1),
        "target_offset_meters": round(t_dist, 1),
        "total_distance_meters": round(total_distance_m, 1),
        "total_distance_km": round(total_distance_m / 1000.0, 2),
        "start_snapped_location": [u_snap[0], u_snap[1]],
        "target_snapped_location": [t_snap[0], t_snap[1]],
    }


def select_route_candidates(candidates, preferred_center_id=None):
    viable = [
        candidate for candidate in candidates
        if candidate and candidate.get("evacuation_center", {}).get("id") is not None
    ]
    viable.sort(key=lambda candidate: candidate["walking_distance_meters"])

    if preferred_center_id is None:
        primary = viable[0] if viable else None
    else:
        primary = next(
            (
                candidate for candidate in viable
                if str(candidate["evacuation_center"]["id"]) == str(preferred_center_id)
            ),
            None,
        )

    alternative = next(
        (
            candidate for candidate in viable
            if primary is None
            or str(candidate["evacuation_center"]["id"])
            != str(primary["evacuation_center"]["id"])
        ),
        None,
    )
    return primary, alternative


def select_closest_alternative_center(candidates):
    """Choose the other mapped center nearest by straight-line distance."""
    viable = [(center, distance) for center, distance in candidates if center is not None]
    return min(viable, key=lambda item: item[1])[0] if viable else None


def get_centers_free_capacity(centers):
    center_ids = [center.id for center in centers]
    capacity_by_center = {
        center_id: {"free_family_slots": 0, "free_people_spaces": 0, "total_people_spaces": 0}
        for center_id in center_ids
    }
    if not center_ids:
        return capacity_by_center

    rooms = (
        EvacuationCenterRoom.query.options(
            joinedload(EvacuationCenterRoom.building).load_only(
                EvacuationCenterBuilding.id,
                EvacuationCenterBuilding.status,
            )
        )
        .filter_by(is_active=True)
        .filter(EvacuationCenterRoom.evacuation_center_id.in_(center_ids))
        .all()
    )
    rooms = [
        room for room in rooms
        if room.building is None
        or str(room.building.status or "open").lower() not in {"closed", "under_repair"}
    ]
    usage = EvacuationCenterRoom.bulk_capacity_usage(rooms)
    for room in rooms:
        entry = capacity_by_center[room.evacuation_center_id]
        entry["free_family_slots"] += usage[room.id]["available_slots"]
        entry["free_people_spaces"] += usage[room.id]["available_spaces"]
        entry["total_people_spaces"] += int(room.people_spaces or room.capacity or 0)

    # Open-area centers (e.g. covered courts / plazas) track capacity directly on the center rather than rooms.
    open_area_centers = [
        center for center in centers
        if (getattr(center, "structure_mode", None) or "buildings_and_rooms") == "open_area"
        and int(center.capacity or 0) > 0
    ]
    if open_area_centers:
        open_area_ids = [center.id for center in open_area_centers]
        assigned_counts = dict(
            db.session.query(
                EvacuationAssignment.evacuation_center_id,
                func.count(EvacuationAssignment.id),
            )
            .filter(EvacuationAssignment.evacuation_center_id.in_(open_area_ids))
            .group_by(EvacuationAssignment.evacuation_center_id)
            .all()
        )
        walkin_counts = {}
        try:
            walkin_counts = dict(
                db.session.query(
                    NonRegisteredEvacuee.center_id,
                    func.count(NonRegisteredEvacuee.id),
                )
                .join(
                    EvacuationOperation,
                    NonRegisteredEvacuee.operation_id == EvacuationOperation.id,
                )
                .filter(
                    NonRegisteredEvacuee.center_id.in_(open_area_ids),
                    NonRegisteredEvacuee.departed_at.is_(None),
                    EvacuationOperation.status == "active",
                )
                .group_by(NonRegisteredEvacuee.center_id)
                .all()
            )
        except Exception:
            db.session.rollback()
        for center in open_area_centers:
            total_cap = int(center.capacity or 0)
            used_people = int(assigned_counts.get(center.id, 0) or 0) + int(walkin_counts.get(center.id, 0) or 0)
            free_people = max(total_cap - used_people, 0)
            capacity_by_center[center.id] = {
                "free_family_slots": math.ceil(free_people / 5) if free_people > 0 else 0,
                "free_people_spaces": free_people,
                "total_people_spaces": total_cap,
            }

    return capacity_by_center


def describe_fallback_reason(assigned_route, assigned_capacity=None):
    """Distinguish why a requested center fell back: unreachable, no_capacity, or full."""
    if assigned_route is None:
        return "unreachable"
    total_spaces = (
        assigned_capacity.get("total_people_spaces", 0)
        if isinstance(assigned_capacity, dict)
        else int(assigned_route.get("evacuation_center", {}).get("total_people_spaces") or 0)
    )
    if total_spaces <= 0:
        return "no_capacity"
    return "full"


def choose_safe_route(candidates, assigned_center_id=None):
    """Return an assigned route, nearest safe fallback, or no-safe-center state."""
    safe_candidates = [
        candidate for candidate in candidates
        if candidate["evacuation_center"]["free_family_slots"] > 0
        and candidate["evacuation_center"]["free_people_spaces"] > 0
    ]
    safe_candidates.sort(key=lambda candidate: candidate["walking_distance_meters"])

    assigned = next(
        (
            candidate for candidate in candidates
            if assigned_center_id is not None
            and str(candidate["evacuation_center"]["id"]) == str(assigned_center_id)
        ),
        None,
    )
    if assigned is not None and assigned in safe_candidates:
        return assigned, "assigned", None

    if assigned_center_id is None:
        return (safe_candidates[0], "nearest_safe", None) if safe_candidates else (None, "no_safe_center", None)

    fallback = next(
        (
            candidate for candidate in safe_candidates
            if str(candidate["evacuation_center"]["id"]) != str(assigned_center_id)
        ),
        None,
    )
    if fallback is None:
        return None, "no_safe_center", assigned
    return fallback, "fallback", assigned


def _alternative_route_summary(candidate, selection_reason):
    if not candidate:
        return None
    center = candidate["evacuation_center"]
    entrance = center.get("chosen_entrance")
    return {
        "evacuation_center": {
            "id": center["id"],
            "name": center["name"],
            "free_family_slots": center.get("free_family_slots"),
            "free_people_spaces": center.get("free_people_spaces"),
            "latitude": center["latitude"],
            "longitude": center["longitude"],
            "chosen_entrance": entrance,
        },
        "distance_km": candidate["distance_km"],
        "walking_distance_meters": candidate["walking_distance_meters"],
        "estimated_time_min": candidate["estimated_time_min"],
        "selection_reason": selection_reason,
    }


def find_best_evacuation_route(user_lat, user_lng, center_id=None, heading=None):
    """
    Finds the optimal evacuation center entrance based on REAL walking distance
    to its snapped road point, skipping unreachable or out-of-bounds entrances.
    """
    all_active_centers = (
        EvacuationCenter.query.options(
            defer(EvacuationCenter.geom),
            selectinload(EvacuationCenter.barangay_links)
            .joinedload(CenterBarangay.barangay)
            .load_only(Barangay.id, Barangay.name),
        )
        .filter_by(is_active=True)
        .all()
    )
    centers = [
        center for center in all_active_centers
        if str(center.evacuation_status or "standby").strip().lower()
        not in {"closed", "concluded"}
    ]
    assigned_center = None
    if center_id is not None:
        assigned_center = next(
            (c for c in all_active_centers if str(c.id) == str(center_id)),
            None,
        )
        if assigned_center is None:
            assigned_center = db.session.get(EvacuationCenter, center_id)
    route_centers = centers
    alternative_reason = "Next closest safe center by walking distance."
    center_candidates = []
    capacity_by_center = get_centers_free_capacity(route_centers)

    start_access = assess_user_start_access(user_lat, user_lng, heading=heading)
    user_trapped = bool(start_access["trapped"])
    start_snap = start_access["snap"]

    for center in ([] if user_trapped else route_centers):
        if center.entrance_geom is None:
            continue

        try:
            multipoint = to_shape(center.entrance_geom)
            pts = list(multipoint.geoms) if hasattr(multipoint, "geoms") else [multipoint]
        except Exception as e:
            logger.warning(f"Error parsing entrance geometry for center {center.id}: {e}")
            continue

        all_entrances_info = []
        center_best_result = None
        free_capacity = capacity_by_center[center.id]

        for idx, entrance_pt in enumerate(pts):
            entrance_lat, entrance_lng = entrance_pt.y, entrance_pt.x
            entrance_name = f"Entrance {idx + 1}"

            # Snap check & diagnostics (strictly project onto road edge without vertex overshoot)
            _, edge_dist_m, sub_info, is_conn = snap_point_to_road(
                entrance_lat, entrance_lng, snap_to_intersection=False
            )
            is_problem = (edge_dist_m > MAX_ENTRANCE_SNAP_DISTANCE_METERS) or (not is_conn)

            entrance_meta = {
                "index": idx + 1,
                "name": entrance_name,
                "latitude": entrance_lat,
                "longitude": entrance_lng,
                "snap_distance_meters": round(edge_dist_m, 1),
                "nearest_road": sub_info["road_name"] if sub_info else "Unknown",
                "is_connected": is_conn,
                "has_warning": is_problem,
            }
            all_entrances_info.append(entrance_meta)

            if is_problem:
                logger.warning(
                    f"Skipping problematic entrance: {center.name} - {entrance_name} "
                    f"(snap={edge_dist_m:.1f}m, connected={is_conn})"
                )
                continue

            # Calculate edge-snapped walking path
            route_res = calculate_route_with_edge_snapping(
                user_lat,
                user_lng,
                entrance_lat,
                entrance_lng,
                heading=heading,
                start_snap=start_snap,
            )
            if not route_res:
                logger.warning(
                    f"No walkable path to {center.name} - {entrance_name} from ({user_lat}, {user_lng})"
                )
                continue

            total_m = route_res["total_distance_meters"]
            if center_best_result is None or total_m < center_best_result["walking_distance_meters"]:
                center_best_result = {
                    "evacuation_center": {
                        "id": center.id,
                        "name": center.name,
                        "barangays": [
                            {
                                "id": link.barangay.id,
                                "name": link.barangay.name,
                                "color": link.color,
                            }
                            for link in center.barangay_links
                            if link.barangay is not None
                        ],
                        "capacity": center.capacity,
                        **free_capacity,
                        "latitude": entrance_lat,
                        "longitude": entrance_lng,
                        "chosen_entrance": {
                            "index": idx + 1,
                            "name": entrance_name,
                            "latitude": entrance_lat,
                            "longitude": entrance_lng,
                            "snap_distance_meters": round(edge_dist_m, 1),
                            "nearest_road": sub_info["road_name"] if sub_info else "Unknown",
                        },
                        "entrances": all_entrances_info,
                    },
                    "distance_km": route_res["total_distance_km"],
                    "walking_distance_meters": total_m,
                    "walking_duration_seconds": math.ceil(total_m / 1.38),  # ~5 km/h = 1.38 m/s
                    "estimated_time_min": max(1, math.ceil((total_m / 1000.0 / 5.0) * 60)),
                    "route": route_res["road_coordinates"],
                    "start_leg": route_res["start_leg"],
                    "final_leg": route_res["final_leg"],
                    "start_snapped_location": route_res["start_snapped_location"],
                    "target_snapped_location": route_res["target_snapped_location"],
                }

        if center_best_result is not None:
            center_candidates.append(center_best_result)

    best_result, fallback_state, assigned_route = choose_safe_route(
        center_candidates,
        assigned_center_id=center_id,
    )
    alternative_result = next(
        (
            candidate for candidate in sorted(
                center_candidates,
                key=lambda item: item["walking_distance_meters"],
            )
            if candidate is not best_result
            and candidate["evacuation_center"]["free_family_slots"] > 0
            and candidate["evacuation_center"]["free_people_spaces"] > 0
        ),
        None,
    )

    if best_result is None:
        target_center = assigned_center or (centers[0] if centers else None)

        center_info = None
        if target_center:
            c_lat = None
            c_lng = None
            if target_center.entrance_geom is not None:
                try:
                    mp = to_shape(target_center.entrance_geom)
                    pt = list(mp.geoms)[0] if hasattr(mp, "geoms") else mp
                    c_lat, c_lng = pt.y, pt.x
                except Exception:
                    pass
            elif target_center.geom is not None:
                try:
                    poly = to_shape(target_center.geom)
                    c_lat, c_lng = poly.centroid.y, poly.centroid.x
                except Exception:
                    pass

            center_info = {
                "id": target_center.id,
                "name": target_center.name,
                "latitude": c_lat,
                "longitude": c_lng,
            }

        # If no center could be reached at all (0 reachable candidates) and closed roads
        # exist while mapped active centers exist, all routes out to shelters are cut off
        # (regardless of whether the user's side of the cut happens to be largest_cc).
        net_now = get_road_network()
        has_closed_roads = bool(net_now.get("closed_lines"))
        has_mapped_centers = any(c.entrance_geom is not None for c in route_centers)
        isolated_trapped = (
            not center_candidates
            and (
                user_trapped
                or (has_closed_roads and has_mapped_centers)
            )
        )
        is_trapped = bool(user_trapped or isolated_trapped)
        trapped_message = (
            "You appear to be surrounded by closed or flooded roads. "
            "Do not attempt to cross — stay put in a safe, elevated place and wait for rescue."
        )

        blocked_result = {
            "no_roads_available": True,
            "all_blocked": True,
            "no_safe_center": True,
            "user_trapped": is_trapped,
            "trapped_reason": start_access.get("reason") or ("all_routes_blocked_by_closed_roads" if is_trapped else None),
            "fallback_state": "trapped" if is_trapped else "no_safe_center",
            "evacuation_center": center_info,
            "assigned_center": center_info if center_id is not None else None,
            "message": trapped_message if is_trapped else "No safe evacuation center with available spaces can be reached.",
            "route": [],
            "distance_km": None,
            "estimated_time_min": None,
        }
        if alternative_result:
            blocked_result["alternative_center"] = _alternative_route_summary(
                alternative_result, alternative_reason
            )
        return blocked_result, None

    best_result["fallback_state"] = fallback_state
    best_result["no_safe_center"] = False
    if center_id is not None:
        best_result["assigned_center"] = {
            "id": assigned_center.id if assigned_center else center_id,
            "name": assigned_center.name if assigned_center else None,
        }
    if fallback_state == "fallback":
        assigned_cap = capacity_by_center.get(assigned_center.id) if assigned_center else None
        best_result["fallback_reason"] = describe_fallback_reason(assigned_route, assigned_cap)
        best_result["selection_reason"] = (
            "Nearest reachable center with free family slots and people spaces, "
            "measured by walking distance."
        )
    elif fallback_state == "assigned":
        best_result["selection_reason"] = "Your assigned center is reachable and has available spaces."
    else:
        best_result["selection_reason"] = "Nearest reachable center with free family slots and people spaces."
    best_result["alternative_center"] = _alternative_route_summary(
        alternative_result, alternative_reason
    )
    return best_result, None


def audit_problem_entrances():
    """
    Scans all active centers for entrances with snap distance > 25m or disconnected roads.
    Returns list of problem entrance descriptors.
    """
    centers = EvacuationCenter.query.filter_by(is_active=True).all()
    problems = []

    for center in centers:
        if center.entrance_geom is None:
            continue
        try:
            multipoint = to_shape(center.entrance_geom)
            pts = list(multipoint.geoms) if hasattr(multipoint, "geoms") else [multipoint]
        except Exception:
            continue

        for idx, pt in enumerate(pts):
            lat, lng = pt.y, pt.x
            _, edge_dist_m, sub_info, is_conn = snap_point_to_road(lat, lng)
            reasons = []
            if edge_dist_m > MAX_ENTRANCE_SNAP_DISTANCE_METERS:
                reasons.append(f"Snap distance is {edge_dist_m:.1f}m (> 25m threshold)")
            if not is_conn:
                reasons.append("Road segment is not connected to the walkable network")

            if reasons:
                problems.append(
                    {
                        "center_id": center.id,
                        "center_name": center.name,
                        "entrance_index": idx + 1,
                        "entrance_name": f"Entrance {idx + 1}",
                        "latitude": lat,
                        "longitude": lng,
                        "snap_distance_meters": round(edge_dist_m, 1),
                        "nearest_road": sub_info["road_name"] if sub_info else "Unknown",
                        "is_connected": is_conn,
                        "warning": "; ".join(reasons),
                    }
                )

    return problems
