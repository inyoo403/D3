// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./_leafletWorkaround.ts";
import "./style.css";

const CLASSROOM_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);

function ensureMapContainer(): HTMLDivElement {
  let el = document.getElementById("map") as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = "map";
    document.body.appendChild(el);
  }
  return el;
}

const map = leaflet.map(ensureMapContainer(), {
  center: CLASSROOM_LATLNG,
  zoom: 19,
  zoomControl: true,
  attributionControl: false,
});

leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20,
}).addTo(map);

leaflet.marker(CLASSROOM_LATLNG).addTo(map).bindTooltip("You", {
  permanent: true,
  direction: "top",
  offset: [-16, -15],
});

const CELL_DEG = 1e-4;

export type IJ = { i: number; j: number };

export function toIJ(lat: number, lng: number): IJ {
  return { i: Math.floor(lat / CELL_DEG), j: Math.floor(lng / CELL_DEG) };
}

export function cellBounds(
  i: number,
  j: number,
): leaflet.LatLngBoundsExpression {
  const south = i * CELL_DEG;
  const north = (i + 1) * CELL_DEG;
  const west = j * CELL_DEG;
  const east = (j + 1) * CELL_DEG;
  return [
    [south, west],
    [north, east],
  ];
}

export function cellCenter(i: number, j: number): leaflet.LatLngExpression {
  return [(i + 0.5) * CELL_DEG, (j + 0.5) * CELL_DEG];
}
