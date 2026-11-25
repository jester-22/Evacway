import math
from flask import Blueprint, request, jsonify
from services.pathfinding import (
    find_best_evacuation_route,
    audit_problem_entrances,
    snap_point_to_road,
    invalidate_road_network_cache,
)

routing_bp = Blueprint("routing", __name__)


@routing_bp.route("/api/evacuation-route", methods=["GET"])
def get_evacuation_route():
    try:
        user_lat = float(request.args.get("lat"))
        user_lng = float(request.args.get("lng"))
    except (TypeError, ValueError):
        return jsonify({"error": "lat and lng query params are required"}), 400

    raw_center_id = request.args.get("center_id")
    center_id = None
    if raw_center_id:
        try:
            center_id = int(raw_center_id)
        except ValueError:
            pass

    raw_heading = request.args.get("heading")
    heading = None
    if raw_heading is not None and raw_heading != "":
        try:
            parsed_heading = float(raw_heading)
            if math.isfinite(parsed_heading) and 0.0 <= parsed_heading <= 360.0:
                heading = parsed_heading % 360.0
        except ValueError:
            pass

    route_data, error_msg = find_best_evacuation_route(
        user_lat, user_lng, center_id=center_id, heading=heading
    )
    if error_msg:
        status_code = (
            404
            if (
                "not found" in error_msg.lower()
                or "not have any mapped entrances" in error_msg.lower()
                or "no reachable entrance" in error_msg.lower()
            )
            else 400
        )
        return jsonify({"error": error_msg}), status_code

    return jsonify(route_data)


@routing_bp.route("/api/routing/problem-entrances", methods=["GET"])
def get_problem_entrances():
    """Returns all active center entrances flagged for snap distance > 25m or disconnected roads."""
    problems = audit_problem_entrances()
    return jsonify(
        {
            "problem_entrances": problems,
            "count": len(problems),
        }
    )


@routing_bp.route("/api/routing/snap", methods=["GET"])
def snap_coordinate():
    """Utility endpoint to test edge snapping for any coordinate."""
    try:
        lat = float(request.args.get("lat"))
        lng = float(request.args.get("lng"))
    except (TypeError, ValueError):
        return jsonify({"error": "lat and lng query params are required"}), 400

    snap_to_intersection = request.args.get("snap_intersection", "false").lower() in {"1", "true", "yes"}
    raw_heading = request.args.get("heading")
    heading = None
    if raw_heading is not None and raw_heading != "":
        try:
            parsed_heading = float(raw_heading)
            if math.isfinite(parsed_heading) and 0.0 <= parsed_heading <= 360.0:
                heading = parsed_heading % 360.0
        except ValueError:
            pass

    snap_pt, dist_m, sub_info, is_conn = snap_point_to_road(
        lat, lng, snap_to_intersection=snap_to_intersection, heading=heading
    )
    return jsonify(
        {
            "snapped_lat": snap_pt[0],
            "snapped_lng": snap_pt[1],
            "snap_distance_meters": round(dist_m, 1),
            "nearest_road": sub_info["road_name"] if sub_info else None,
            "is_connected": is_conn,
        }
    )
