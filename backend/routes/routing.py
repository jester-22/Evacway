from flask import Blueprint, request, jsonify
from models import RoadSegment, EvacuationCenter
from geoalchemy2.shape import to_shape
import networkx as nx
import math
from functools import lru_cache

routing_bp = Blueprint('routing', __name__)

# Roads marked closed (flooded/blocked) aren't removed from the graph —
# they're just made extremely expensive to use, so the algorithm only
# takes them if there's truly no other way through. This matches the
# proposal's "hazard penalties multiplying road weights" approach.
CLOSED_ROAD_PENALTY = 50

# Global cache for the road graph to avoid rebuilding on every request
_cached_graph = None

def haversine(lat1, lon1, lat2, lon2):
    """Distance in km between two lat/lng points."""
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def build_road_graph():
    """Builds a NetworkX graph where nodes are road endpoints (lat, lng)
    and edges are road segments, weighted by distance and closure status."""
    global _cached_graph
    
    # In a real production app, we would use a more robust invalidation strategy
    # (e.g., updating the cache only when RoadSegment is modified).
    # For now, we build it once and reuse it.
    if _cached_graph is not None:
        return _cached_graph

    G = nx.Graph()
    segments = RoadSegment.query.all()

    for seg in segments:
        line = to_shape(seg.geom)
        coords = list(line.coords)  # [(lng, lat), (lng, lat), ...]

        # Walk the line point-by-point so curved roads are represented
        # as multiple connected edges, not one straight shortcut.
        for i in range(len(coords) - 1):
            lng1, lat1 = coords[i]
            lng2, lat2 = coords[i + 1]
            node_a = (round(lat1, 6), round(lng1, 6))
            node_b = (round(lat2, 6), round(lng2, 6))

            dist_km = haversine(lat1, lng1, lat2, lng2)
            weight = dist_km * seg.base_weight
            if seg.is_closed:
                weight *= CLOSED_ROAD_PENALTY

            G.add_edge(node_a, node_b, weight=weight)

    _cached_graph = G
    return G


def nearest_node(G, lat, lng):
    """Finds the closest graph node to an arbitrary point (user location
    or evacuation center), since those won't sit exactly on a road node."""
    best_node = None
    best_dist = float('inf')
    
    # Optimization: We could use a KD-Tree here, but that requires scipy.
    # Given the current requirements.txt, we'll keep the search but the 
    # cached graph already removes the most significant overhead.
    for node in G.nodes:
        d = haversine(lat, lng, node[0], node[1])
        if d < best_dist:
            best_dist = d
            best_node = node
    return best_node, best_dist


@routing_bp.route('/api/evacuation-route', methods=['GET'])
def get_evacuation_route():
    try:
        user_lat = float(request.args.get('lat'))
        user_lng = float(request.args.get('lng'))
    except (TypeError, ValueError):
        return jsonify({"error": "lat and lng query params are required"}), 400

    G = build_road_graph()
    if G.number_of_nodes() == 0:
        return jsonify({"error": "No road network data available yet"}), 503

    user_node, user_offset = nearest_node(G, user_lat, user_lng)

    centers = EvacuationCenter.query.filter_by(is_active=True).all()
    if not centers:
        return jsonify({"error": "No active evacuation centers available"}), 503

    best_result = None

    for center in centers:
        if center.entrance_geom is None:
            continue

        multipoint = to_shape(center.entrance_geom)

        # Check every entrance and route to whichever is actually closest —
        # a center with a back entrance nearer the user should win over
        # always defaulting to the front door.
        for entrance_pt in multipoint.geoms:
            entrance_lat, entrance_lng = entrance_pt.y, entrance_pt.x
            center_node, center_offset = nearest_node(G, entrance_lat, entrance_lng)

            try:
                path_nodes = nx.dijkstra_path(G, user_node, center_node, weight='weight')
                path_length = nx.dijkstra_path_length(G, user_node, center_node, weight='weight')
            except nx.NetworkXNoPath:
                continue

            total_distance = path_length + user_offset + center_offset

            if best_result is None or total_distance < best_result['distance_km']:
                best_result = {
                    "evacuation_center": {
                        "id": center.id,
                        "name": center.name,
                        "barangay": center.barangay,
                        "capacity": center.capacity,
                        "latitude": entrance_lat,
                        "longitude": entrance_lng
                    },
                    "distance_km": round(total_distance, 2),
                    "estimated_time_min": round((total_distance / 5) * 60),
                    "route": [[lat, lng] for (lat, lng) in path_nodes]
                }

    if best_result is None:
        return jsonify({"error": "No reachable evacuation center found — road network may be disconnected, or no centers have an entrance point set yet"}), 503
    return jsonify(best_result)
