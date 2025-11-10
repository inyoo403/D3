// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./_leafletWorkaround.ts";
import luck from "./_luck.ts";
import "./style.css";

const CLASSROOM_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);
const CELL_DEG = 1e-4;
const INTERACT_RANGE = 3;
const MAX_RADIUS = 20;

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
  maxZoom: 19,
  zoomControl: true,
  attributionControl: false,
  doubleClickZoom: false,
});

leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  maxNativeZoom: 19,
}).addTo(map);

leaflet.marker(CLASSROOM_LATLNG).addTo(map).bindTooltip("You", {
  permanent: true,
  direction: "top",
  offset: [-16, -15],
});

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

const cellLayer = leaflet.layerGroup().addTo(map);
const labelLayer = leaflet.layerGroup().addTo(map);

function spawnValue(i: number, j: number): number {
  const r = luck(`spawn:${i},${j}`);
  if (r < 0.25) return 1;
  if (r < 0.30) return 2;
  if (r < 0.32) return 4;
  return 0;
}

function isNear(i: number, j: number, ip: number, jp: number): boolean {
  return Math.abs(i - ip) <= INTERACT_RANGE &&
    Math.abs(j - jp) <= INTERACT_RANGE;
}

function renderGrid(bounds: leaflet.LatLngBounds) {
  cellLayer.clearLayers();
  labelLayer.clearLayers();

  const zoom = map.getZoom();
  if (zoom < 18) return;

  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();

  const iMinView = Math.floor(south / CELL_DEG) - 1;
  const iMaxView = Math.floor(north / CELL_DEG) + 1;
  const jMinView = Math.floor(west / CELL_DEG) - 1;
  const jMaxView = Math.floor(east / CELL_DEG) + 1;

  const p = toIJ(CLASSROOM_LATLNG.lat, CLASSROOM_LATLNG.lng);
  const iMin = Math.max(p.i - MAX_RADIUS, iMinView);
  const iMax = Math.min(p.i + MAX_RADIUS, iMaxView);
  const jMin = Math.max(p.j - MAX_RADIUS, jMinView);
  const jMax = Math.min(p.j + MAX_RADIUS, jMaxView);

  for (let i = iMin; i <= iMax; i++) {
    for (let j = jMin; j <= jMax; j++) {
      const near = isNear(i, j, p.i, p.j);

      leaflet.rectangle(cellBounds(i, j), {
        color: near ? "#1f6feb" : "#555",
        weight: near ? 2 : 1,
        opacity: near ? 0.8 : 0.4,
        fill: false,
      }).addTo(cellLayer);

      const v = spawnValue(i, j);
      if (v > 0) {
        const div = document.createElement("div");
        div.className = "cellLabel";
        div.textContent = String(v);
        const icon = leaflet.divIcon({
          html: div,
          className: "cellLabelWrap",
          iconSize: [0, 0],
        });
        leaflet.marker(cellCenter(i, j), { icon }).addTo(labelLayer);
      }
    }
  }
}

renderGrid(map.getBounds());
map.on("moveend", () => renderGrid(map.getBounds()));
