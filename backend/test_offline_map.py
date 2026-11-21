import unittest
from types import SimpleNamespace
from unittest.mock import patch

from flask import Flask
from shapely.geometry import MultiPoint, Point

from models import EvacuationCenter
import routes.offline_map as offline_map_routes
from routes.evacuation_centers import centers_bp
from routes.offline_map import (
    OPENFREEMAP_USER_AGENT,
    offline_map_bp,
    tile_is_in_sogod_bounds,
)


class OfflineMapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app = Flask(__name__)
        app.config.update(TESTING=True)
        app.register_blueprint(centers_bp)
        app.register_blueprint(offline_map_bp)
        cls.app = app
        cls.client = app.test_client()

    def test_tile_bounds_limit_proxy_to_sogod_and_zoom_11_to_14(self):
        self.assertTrue(tile_is_in_sogod_bounds(14, 13876, 7710))
        self.assertFalse(tile_is_in_sogod_bounds(14, 0, 0))
        self.assertFalse(tile_is_in_sogod_bounds(10, 6945, 3855))
        self.assertFalse(tile_is_in_sogod_bounds(15, 27752, 15420))

    @patch("routes.offline_map.requests.get")
    def test_tile_proxy_sets_app_user_agent_and_rejects_out_of_area(self, get):
        offline_map_routes._tile_url_template = None
        offline_map_routes._tile_url_template_expires_at = 0
        metadata = SimpleNamespace(
            status_code=200,
            json=lambda: {
                "tiles": ["https://tiles.openfreemap.org/planet/test_version/{z}/{x}/{y}.pbf"]
            },
            raise_for_status=lambda: None,
        )
        tile = SimpleNamespace(
            status_code=200,
            content=b"tile-data",
            headers={"Content-Type": "application/x-protobuf", "Content-Length": "9"},
        )
        get.side_effect = [metadata, tile]

        response = self.client.get("/api/public/offline-map/tiles/14/13876/7710")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, b"tile-data")
        self.assertEqual(response.headers.get("Cache-Control"), "public, max-age=2592000")
        self.assertEqual(get.call_count, 2)
        self.assertTrue(all(
            call.kwargs["headers"]["User-Agent"] == OPENFREEMAP_USER_AGENT
            for call in get.call_args_list
        ))
        self.assertEqual(
            get.call_args_list[1].args[0],
            "https://tiles.openfreemap.org/planet/test_version/14/13876/7710.pbf",
        )

        rejected = self.client.get("/api/public/offline-map/tiles/14/0/0")
        self.assertEqual(rejected.status_code, 404)
        self.assertEqual(get.call_count, 2)

    @patch("routes.evacuation_centers.to_shape")
    def test_public_offline_center_list_contains_safe_entrances(self, to_shape):
        to_shape.side_effect = [
            Point(124.99, 10.39),
            MultiPoint([(124.991, 10.391), (124.992, 10.392)]),
        ]
        center = SimpleNamespace(
            id=7,
            name="Sogod Evacuation Center",
            geom=object(),
            is_active=True,
            evacuation_status="Open",
            entrance_geom=object(),
            contact_number="private phone",
            owner_name="private owner",
        )

        class QueryStub:
            def filter(self, *_expressions):
                return self

            def order_by(self, *_expressions):
                return self

            def all(self):
                return [center]

        with self.app.app_context():
            with patch.object(EvacuationCenter, "query", QueryStub()):
                response = self.client.get("/api/public/offline-centers")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(response.headers.get("Cache-Control"), "public, max-age=0, must-revalidate")
        self.assertEqual(len(payload["features"]), 1)
        feature = payload["features"][0]
        self.assertEqual(
            set(feature["properties"]),
            {"id", "name", "is_active", "evacuation_status", "entrances"},
        )
        self.assertEqual(feature["properties"]["name"], "Sogod Evacuation Center")
        self.assertEqual(feature["properties"]["entrances"], [
            {"name": "Entrance 1", "lat": 10.391, "lng": 124.991},
            {"name": "Entrance 2", "lat": 10.392, "lng": 124.992},
        ])
        self.assertNotIn("contact_number", feature["properties"])
        self.assertNotIn("owner_name", feature["properties"])
        self.assertTrue(payload["last_updated"])


if __name__ == "__main__":
    unittest.main()
