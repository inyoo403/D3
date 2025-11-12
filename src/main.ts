// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./_leafletWorkaround.ts";
import luck from "./_luck.ts";
import "./style.css";

const START_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);
const CELL_DEG = 1e-4;
const INTERACT_RANGE = 3;
const TARGET = 32;

const hud = document.createElement("div");
hud.id = "hud";
document.body.appendChild(hud);

const controls = document.createElement("div");
controls.id = "controls";
document.body.appendChild(controls);

let inHand: number | null = null;
const overrides = new Map<string, number>();
function key(i: number, j: number) {
  return `${i},${j}`;
}

function clearVisibleState() {
  overrides.clear();
}

function updateHUD() {
  hud.textContent = `In hand: ${
    inHand == null ? "—" : inHand
  }  Pos: (${playerIJ.i}, ${playerIJ.j})`;
}

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
  center: START_LATLNG,
  zoom: 19,
  maxZoom: 19,
  zoomControl: true,
  attributionControl: false,
  doubleClickZoom: false,
});
map.zoomControl.setPosition("topright");

const playerPane = map.createPane("player");
playerPane.style.zIndex = "650";
playerPane.style.pointerEvents = "none";

const labelsPane = map.createPane("labels");
labelsPane.style.zIndex = "660";
labelsPane.style.pointerEvents = "none";

leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  maxNativeZoom: 19,
}).addTo(map);

export type IJ = { i: number; j: number };
export function toIJ(lat: number, lng: number): IJ {
  return { i: Math.floor(lat / CELL_DEG), j: Math.floor(lng / CELL_DEG) };
}
export function cellBounds(
  i: number,
  j: number,
): leaflet.LatLngBoundsExpression {
  const south = i * CELL_DEG,
    north = (i + 1) * CELL_DEG,
    west = j * CELL_DEG,
    east = (j + 1) * CELL_DEG;
  return [[south, west], [north, east]];
}
export function cellCenter(i: number, j: number): leaflet.LatLngExpression {
  return [(i + 0.5) * CELL_DEG, (j + 0.5) * CELL_DEG];
}

let playerIJ: IJ = toIJ(START_LATLNG.lat, START_LATLNG.lng);

const playerMarker = leaflet
  .marker(cellCenter(playerIJ.i, playerIJ.j), {
    interactive: false,
    pane: "player",
  })
  .addTo(map)
  .bindTooltip("You", {
    permanent: true,
    direction: "top",
    offset: [-16, -15],
    pane: "player",
  });

const cellLayer = leaflet.layerGroup().addTo(map);
const labelLayer = leaflet.layerGroup().addTo(map);

function spawnValue(i: number, j: number): number {
  const r = luck(`spawn:${i},${j}`);
  if (r < 0.25) return 1;
  if (r < 0.30) return 2;
  if (r < 0.32) return 4;
  return 0;
}
function tintColorFor(v: number): string {
  if (v <= 0) return "transparent";
  const level = Math.floor(Math.log2(v));
  const lightness = Math.max(35, 85 - level * 10);
  return `hsl(35 95% ${lightness}%)`;
}
function getCellValue(i: number, j: number): number {
  const k = key(i, j);
  return overrides.has(k) ? overrides.get(k)! : spawnValue(i, j);
}
function setCellValue(i: number, j: number, v: number) {
  overrides.set(key(i, j), v);
}
function isNear(i: number, j: number, ip: number, jp: number): boolean {
  return Math.abs(i - ip) <= INTERACT_RANGE &&
    Math.abs(j - jp) <= INTERACT_RANGE;
}

function renderGrid(bounds: leaflet.LatLngBounds) {
  cellLayer.clearLayers();
  labelLayer.clearLayers();

  const zoom = map.getZoom();
  if (zoom < 18) {
    updateHUD();
    return;
  }
  const labelPx = Math.max(12, 12 + 4 * (zoom - 18));

  const south = bounds.getSouth(),
    north = bounds.getNorth(),
    west = bounds.getWest(),
    east = bounds.getEast();
  const iMinView = Math.floor(south / CELL_DEG) - 1;
  const iMaxView = Math.floor(north / CELL_DEG) + 1;
  const jMinView = Math.floor(west / CELL_DEG) - 1;
  const jMaxView = Math.floor(east / CELL_DEG) + 1;

  const iMin = iMinView;
  const iMax = iMaxView;
  const jMin = jMinView;
  const jMax = jMaxView;

  for (let i = iMin; i <= iMax; i++) {
    for (let j = jMin; j <= jMax; j++) {
      const near = isNear(i, j, playerIJ.i, playerIJ.j);
      const v = getCellValue(i, j);

      const tint = tintColorFor(v);

      const rect = leaflet.rectangle(cellBounds(i, j), {
        color: near ? "#1f6feb" : "#888",
        weight: near ? 2 : 1,
        opacity: near ? 0.8 : 0.3,
        fill: true,
        fillColor: tint,
        fillOpacity: v > 0 ? (near ? 0.35 : 0.25) : (near ? 0.08 : 0.04),
      }).addTo(cellLayer);

      rect.on("click", () => {
        if (!isNear(i, j, playerIJ.i, playerIJ.j)) return;
        const cv = getCellValue(i, j);
        if (inHand == null) {
          if (cv > 0) {
            setCellValue(i, j, 0);
            inHand = cv;
            updateHUD();
            renderGrid(map.getBounds());
          }
          return;
        }
        if (cv === inHand && cv > 0) {
          const newVal = inHand * 2;
          setCellValue(i, j, newVal);
          inHand = null;
          updateHUD();
          renderGrid(map.getBounds());
          if (newVal >= TARGET) {
            console.log("You’ve crafted a token of value", newVal);
            alert(`You’ve reached a token value of ${newVal}.`);
          }
          return;
        }
      });

      if (v > 0) {
        const div = document.createElement("div");
        div.textContent = String(v);
        div.style.fontWeight = "700";
        div.style.fontSize = `${labelPx}px`;
        div.style.color = "#222";
        div.style.textShadow = "0 1px 0 rgba(255,255,255,0.7)";
        div.style.transform = "translate(-50%, -50%)";

        const icon = leaflet.divIcon({
          html: div,
          className: "cellLabelWrap",
          iconSize: [0, 0],
        });
        leaflet.marker(cellCenter(i, j), {
          icon,
          interactive: false,
          pane: "labels",
        }).addTo(labelLayer);
      }
    }
  }

  updateHUD();
}

function movePlayer(di: number, dj: number) {
  playerIJ = { i: playerIJ.i + di, j: playerIJ.j + dj };
  const playerLatLng = cellCenter(playerIJ.i, playerIJ.j);
  playerMarker.setLatLng(playerLatLng);

  const bounds = map.getBounds();
  let edgeLatLng: leaflet.LatLng | null = null;

  if (di > 0) {
    edgeLatLng = leaflet.latLng(
      cellCenter(playerIJ.i + INTERACT_RANGE, playerIJ.j),
    );
  } else if (di < 0) {
    edgeLatLng = leaflet.latLng(
      cellCenter(playerIJ.i - INTERACT_RANGE, playerIJ.j),
    );
  } else if (dj > 0) {
    edgeLatLng = leaflet.latLng(
      cellCenter(playerIJ.i, playerIJ.j + INTERACT_RANGE),
    );
  } else if (dj < 0) {
    edgeLatLng = leaflet.latLng(
      cellCenter(playerIJ.i, playerIJ.j - INTERACT_RANGE),
    );
  }

  if (edgeLatLng && !bounds.contains(edgeLatLng)) {
    map.panTo(playerLatLng);
  }

  clearVisibleState();
  renderGrid(map.getBounds());
  updateHUD();
}

function mkBtn(text: string, onClick: () => void) {
  const b = document.createElement("button");
  b.textContent = text;
  b.addEventListener("click", onClick);
  controls.appendChild(b);
}

mkBtn("↑ N", () => movePlayer(+1, 0));
mkBtn("↓ S", () => movePlayer(-1, 0));
mkBtn("← W", () => movePlayer(0, -1));
mkBtn("→ E", () => movePlayer(0, +1));
mkBtn("Center", () => map.setView(playerMarker.getLatLng()));

renderGrid(map.getBounds());
map.on("moveend", () => renderGrid(map.getBounds()));
