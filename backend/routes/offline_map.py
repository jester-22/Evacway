import os
import re
import threading
import time
from urllib.parse import urlparse

import requests
from flask import Blueprint, Response, jsonify


offline_map_bp = Blueprint("offline_map", __name__)

SOGOD_OFFLINE_BOUNDS = {
    "west": 124.912,
    "south": 10.368,
    "east": 125.078,
    "north": 10.525,
}
MIN_TILE_ZOOM = 11
MAX_TILE_ZOOM = 14
OFFLINE_TILE_ZOOM = 14
OPENFREEMAP_TILEJSON_URL = "https://tiles.openfreemap.org/planet"
OPENFREEMAP_USER_AGENT = os.environ.get(
    "EVACWAY_OFFLINE_TILE_USER_AGENT", "EvacWay/1.0 (offline public map)"
)
_tile_template_lock = threading.Lock()
_tile_url_template = None
_tile_url_template_expires_at = 0


def _tile_x(longitude, zoom):
    return int((longitude + 180.0) / 360.0 * (2 ** zoom))


def _tile_y(latitude, zoom):
    import math

    latitude = max(min(latitude, 85.05112878), -85.05112878)
    radians = math.radians(latitude)
    return int((1 - math.asinh(math.tan(radians)) / math.pi) / 2 * (2 ** zoom))


def tile_is_in_sogod_bounds(zoom, x, y):
    if zoom < MIN_TILE_ZOOM or zoom > MAX_TILE_ZOOM:
        return False
    tile_count = 2 ** zoom
    if x < 0 or y < 0 or x >= tile_count or y >= tile_count:
        return False
    bounds = SOGOD_OFFLINE_BOUNDS
    return (
        _tile_x(bounds["west"], zoom) <= x <= _tile_x(bounds["east"], zoom)
        and _tile_y(bounds["north"], zoom) <= y <= _tile_y(bounds["south"], zoom)
    )


def get_openfreemap_tile_url_template():
    global _tile_url_template, _tile_url_template_expires_at
    if _tile_url_template and time.monotonic() < _tile_url_template_expires_at:
        return _tile_url_template

    with _tile_template_lock:
        if _tile_url_template and time.monotonic() < _tile_url_template_expires_at:
            return _tile_url_template

        metadata = requests.get(
            OPENFREEMAP_TILEJSON_URL,
            headers={"User-Agent": OPENFREEMAP_USER_AGENT},
            timeout=(3, 10),
        )
        metadata.raise_for_status()
        tile_urls = metadata.json().get("tiles") or []
        if not tile_urls:
            raise ValueError("OpenFreeMap tile metadata did not include a tile URL.")

        tile_url = tile_urls[0]
        parsed_url = urlparse(tile_url)
        if parsed_url.scheme != "https" or parsed_url.hostname != "tiles.openfreemap.org":
            raise ValueError("OpenFreeMap returned an unsupported tile URL.")
        if not re.fullmatch(r"/planet/[A-Za-z0-9_-]+/\{z\}/\{x\}/\{y\}\.pbf", parsed_url.path):
            raise ValueError("OpenFreeMap returned an unsupported tile template.")

        _tile_url_template = tile_url
        _tile_url_template_expires_at = time.monotonic() + 3600
        return _tile_url_template


@offline_map_bp.get("/api/public/offline-map/tiles/<int:zoom>/<int:x>/<int:y>")
def get_sogod_offline_map_tile(zoom, x, y):
    if not tile_is_in_sogod_bounds(zoom, x, y):
        return jsonify({"error": "Map tile is outside the supported Sogod area."}), 404, {
            "Cache-Control": "no-store"
        }

    try:
        tile_url = get_openfreemap_tile_url_template().format(z=zoom, x=x, y=y)
        upstream = requests.get(
            tile_url,
            headers={"User-Agent": OPENFREEMAP_USER_AGENT},
            timeout=(3, 10),
        )
    except (requests.RequestException, ValueError, KeyError, IndexError):
        return jsonify({"error": "Map tiles are temporarily unavailable."}), 503, {
            "Cache-Control": "no-store"
        }

    if upstream.status_code != 200:
        return jsonify({"error": "Map tiles are temporarily unavailable."}), 503, {
            "Cache-Control": "no-store"
        }

    headers = {"Cache-Control": "public, max-age=2592000"}
    return Response(
        upstream.content,
        status=200,
        content_type=upstream.headers.get("Content-Type", "application/x-protobuf"),
        headers=headers,
    )
