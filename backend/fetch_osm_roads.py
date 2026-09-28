"""
fetch_osm_roads.py — Downloads Sogod's real road network from OpenStreetMap
via osmnx, using a bounding box instead of a place-name lookup (more reliable
for smaller municipalities that Nominatim doesn't have clean polygons for).

Usage (from inside backend/, with venv activated):
    python fetch_osm_roads.py
"""

import osmnx as ox
import os

os.makedirs("data", exist_ok=True)

# Same bounding box used on the frontend map (DashboardMap.jsx / ResidentHome.jsx)
NORTH, SOUTH = 10.56, 10.35
EAST, WEST = 125.11, 124.89

print("Downloading road network for Sogod, Southern Leyte (via bounding box)...")
G = ox.graph_from_bbox((WEST, SOUTH, EAST, NORTH), network_type="drive")

ox.save_graphml(G, "data/sogod_roads.graphml")
print(f"Saved graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")

edges = ox.graph_to_gdfs(G, nodes=False)
edges.to_file("data/roads_sogod.geojson", driver="GeoJSON")
print("Saved data/roads_sogod.geojson")