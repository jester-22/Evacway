import math
import logging
import networkx as nx
from shapely.geometry import Point, LineString
from shapely.strtree import STRtree
from geoalchemy2.shape import to_shape
from models import RoadSegment, EvacuationCenter

logger = logging.getLogger(__name__)

CLOSED_ROAD_PENALTY = 1000000
MAX_ENTRANCE_SNAP_DISTANCE_METERS = 25.0

_cached_network = None


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


def invalidate_road_network_cache():
    """Call whenever road segments or hazard closures change."""
    global _cached_network
    _cached_network = None


def get_road_network():
    """Builds and caches the road network graph and spatial index for fast edge snapping."""
    global _cached_network
    if _cached_network is not None:
        return _cached_network

    G = nx.Graph()
    sub_segments = []
    sub_lines = []

    segments = RoadSegment.query.all()

    for seg in segments:
        if not seg.geom:
            continue
        try:
            line = to_shape(seg.geom)
        except Exception as e:
            logger.warning(f"Failed to parse geometry for road segment {seg.id}: {e}")
            continue

        coords = list(line.coords)
        for i in range(len(coords) - 1):
            lng1, lat1 = coords[i]
            lng2, lat2 = coords[i + 1]

            u = (round(lat1, 6), round(lng1, 6))
            v = (round(lat2, 6), round(lng2, 6))

            dist_km = haversine(lat1, lng1, lat2, lng2)
            weight = dist_km * (seg.base_weight or 1.0)
            if seg.is_closed:
                weight *= CLOSED_ROAD_PENALTY

            G.add_edge(
                u,
                v,
                weight=weight,
                base_weight=seg.base_weight or 1.0,
                is_closed=bool(seg.is_closed),
                seg_id=seg.id,
                road_name=seg.road_name or "Road",
            )

            sub_line = LineString([(lng1, lat1), (lng2, lat2)])
            sub_lines.append(sub_line)
            sub_segments.append(
                {
                    "u": u,
                    "v": v,
                    "sub_line": sub_line,
                    "seg_id": seg.id,
                    "road_name": seg.road_name or "Road",
                    "base_weight": seg.base_weight or 1.0,
                    "is_closed": bool(seg.is_closed),
                }
            )

    spatial_tree = STRtree(sub_lines) if sub_lines else None

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
        "largest_cc": largest_cc,
    }
    return _cached_network


def snap_point_to_road(lat, lng):
    """
    Projects an arbitrary (lat, lng) point onto the nearest road segment.
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
    nearest_idx = spatial_tree.nearest(p)
    best_sub = sub_segments[nearest_idx]

    # Project point onto the nearest line segment
    proj = best_sub["sub_line"].project(p)
    snap_geom = best_sub["sub_line"].interpolate(proj)
    snap_lat = round(snap_geom.y, 6)
    snap_lng = round(snap_geom.x, 6)

    dist_meters = haversine(lat, lng, snap_lat, snap_lng) * 1000.0

    # Connectivity check
    u, v = best_sub["u"], best_sub["v"]
    is_connected = (u in largest_cc) or (v in largest_cc)

    # Intersection snapping: if within 15 meters of an intersection node where multiple
    # segments meet, lock directly to the exact intersection node vertex so reports/pins
    # sit dead-center in the intersection instead of drifting down a single road branch.
    G = net.get("graph")
    if G is not None:
        d_u = haversine(snap_lat, snap_lng, u[0], u[1]) * 1000.0
        d_v = haversine(snap_lat, snap_lng, v[0], v[1]) * 1000.0
        if d_u <= 15.0 and d_u <= d_v and G.has_node(u) and G.degree(u) > 1:
            snap_lat = round(u[0], 6)
            snap_lng = round(u[1], 6)
            dist_meters = haversine(lat, lng, snap_lat, snap_lng) * 1000.0
        elif d_v <= 15.0 and d_v <= d_u and G.has_node(v) and G.degree(v) > 1:
            snap_lat = round(v[0], 6)
            snap_lng = round(v[1], 6)
            dist_meters = haversine(lat, lng, snap_lat, snap_lng) * 1000.0

    return (snap_lat, snap_lng), dist_meters, best_sub, is_connected


def calculate_route_with_edge_snapping(start_lat, start_lng, target_lat, target_lng):
    """
    Computes a walking route from start to target by snapping BOTH endpoints
    to their exact positions along road segments (not vertices) and running Dijkstra.
    Returns:
      dict with road path, legs, and distance metrics, or None if no path exists.
    """
    net = get_road_network()
    G_base = net["graph"]
    if G_base.number_of_nodes() == 0:
        return None

    u_snap, u_dist, u_sub, u_connected = snap_point_to_road(start_lat, start_lng)
    t_snap, t_dist, t_sub, t_connected = snap_point_to_road(target_lat, target_lng)

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
                d = haversine(n1[0], n1[1], n2[0], n2[1])
                w = d * u_sub["base_weight"]
                if u_sub["is_closed"]:
                    w *= CLOSED_ROAD_PENALTY
                G.add_edge(n1, n2, weight=w, is_closed=bool(u_sub["is_closed"]))

        add_split_edge(u_node, first_pt)
        add_split_edge(first_pt, second_pt)
        add_split_edge(second_pt, v_node)

    else:
        # Case 2: Start and target are on different sub-segments
        for snap_pt, sub in [(u_snap, u_sub), (t_snap, t_sub)]:
            if sub is not None and snap_pt != sub["u"] and snap_pt != sub["v"]:
                u_node, v_node = sub["u"], sub["v"]
                if G.has_edge(u_node, v_node):
                    G.remove_edge(u_node, v_node)

                d1 = haversine(u_node[0], u_node[1], snap_pt[0], snap_pt[1])
                w1 = d1 * sub["base_weight"]
                if sub["is_closed"]:
                    w1 *= CLOSED_ROAD_PENALTY

                d2 = haversine(snap_pt[0], snap_pt[1], v_node[0], v_node[1])
                w2 = d2 * sub["base_weight"]
                if sub["is_closed"]:
                    w2 *= CLOSED_ROAD_PENALTY

                G.add_edge(u_node, snap_pt, weight=w1, is_closed=bool(sub["is_closed"]))
                G.add_edge(snap_pt, v_node, weight=w2, is_closed=bool(sub["is_closed"]))

    # Pass 1: Strictly avoid blocked/closed roads
    open_edges = [
        (u, v)
        for u, v, d in G.edges(data=True)
        if not d.get("is_closed", False)
    ]
    G_open = G.edge_subgraph(open_edges)

    path = None
    road_km = 0.0

    if G_open.has_node(u_snap) and G_open.has_node(t_snap):
        try:
            path = nx.dijkstra_path(G_open, u_snap, t_snap, weight="weight")
            road_km = nx.dijkstra_path_length(G_open, u_snap, t_snap, weight="weight")
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            path = None

    # Pass 2: Fallback to full graph with huge penalty only if no alternative route exists
    if path is None:
        try:
            path = nx.dijkstra_path(G, u_snap, t_snap, weight="weight")
            road_km = nx.dijkstra_path_length(G, u_snap, t_snap, weight="weight")
        except (nx.NetworkXNoPath, nx.NodeNotFound):
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


def find_best_evacuation_route(user_lat, user_lng, center_id=None):
    """
    Finds the optimal evacuation center entrance based on REAL walking distance
    to its snapped road point, skipping unreachable or out-of-bounds entrances.
    """
    query = EvacuationCenter.query.filter_by(is_active=True)
    if center_id is not None:
        query = query.filter_by(id=center_id)

    centers = query.all()
    if not centers:
        return None, "No active evacuation centers found matching criteria."

    if center_id is not None:
        target_center = centers[0]
        if target_center.entrance_geom is None:
            return (
                None,
                f"Evacuation center '{target_center.name}' does not have any mapped entrances yet.",
            )

    best_result = None

    for center in centers:
        if center.entrance_geom is None:
            continue

        try:
            multipoint = to_shape(center.entrance_geom)
            pts = list(multipoint.geoms) if hasattr(multipoint, "geoms") else [multipoint]
        except Exception as e:
            logger.warning(f"Error parsing entrance geometry for center {center.id}: {e}")
            continue

        all_entrances_info = []

        for idx, entrance_pt in enumerate(pts):
            entrance_lat, entrance_lng = entrance_pt.y, entrance_pt.x
            entrance_name = f"Entrance {idx + 1}"

            # Snap check & diagnostics
            _, edge_dist_m, sub_info, is_conn = snap_point_to_road(entrance_lat, entrance_lng)
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
                user_lat, user_lng, entrance_lat, entrance_lng
            )
            if not route_res:
                logger.warning(
                    f"No walkable path to {center.name} - {entrance_name} from ({user_lat}, {user_lng})"
                )
                continue

            total_m = route_res["total_distance_meters"]

            if best_result is None or total_m < best_result["walking_distance_meters"]:
                best_result = {
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

    if best_result is None:
        target_desc = f"center '{center_id}'" if center_id else "any active evacuation center"
        return (
            None,
            f"No reachable entrance found for {target_desc}. The road network may be disconnected or all entrances are obstructed.",
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
