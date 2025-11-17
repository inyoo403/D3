// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./_leafletWorkaround.ts";
import luck from "./_luck.ts";
import playerIconUrl from "./assets/player-icon.png";
import "./style.css";

const START_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);
const CELL_DEG = 1e-4;
const INTERACT_RANGE = 3;
const TARGET = 32;
const STORAGE_KEY = "d3_gameState";

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

let playerFacing: "left" | "right" = "right";

function saveState() {
  const state = {
    playerIJ: playerIJ,
    inHand: inHand,
    overrides: Array.from(overrides.entries()),
    playerFacing: playerFacing,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState() {
  const savedState = localStorage.getItem(STORAGE_KEY);
  if (!savedState) return;

  try {
    const state = JSON.parse(savedState);
    if (state.playerIJ) {
      playerIJ = state.playerIJ;
    }
    if (state.inHand !== undefined) {
      inHand = state.inHand;
    }
    if (state.overrides && Array.isArray(state.overrides)) {
      overrides.clear();
      for (const [key, value] of state.overrides) {
        overrides.set(key, value);
      }
    }
    if (state.playerFacing) {
      playerFacing = state.playerFacing;
    }
  } catch (e) {
    console.error("Failed to load state from localStorage:", e);
    localStorage.removeItem(STORAGE_KEY);
  }
}

function updateHUD() {
  hud.textContent = `In hand: ${
    inHand == null ? "—" : inHand
  }  Pos: (${playerIJ.i}, ${playerIJ.j})  Target: ${TARGET}`;
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

loadState();

const playerIcon = leaflet.icon({
  iconUrl: playerIconUrl,
  iconSize: [48, 48],
  iconAnchor: [24, 24],
  tooltipAnchor: [0, -24],
});

const playerMarker = leaflet
  .marker(cellCenter(playerIJ.i, playerIJ.j), {
    icon: playerIcon,
    interactive: false,
    pane: "player",
  });

playerMarker.addTo(map);

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
  return `hsl(35 95% ${lightness})`;
}
function getCellValue(i: number, j: number): number {
  const k = key(i, j);
  return overrides.has(k) ? overrides.get(k)! : spawnValue(i, j);
}
function setCellValue(i: number, j: number, v: number) {
  overrides.set(key(i, j), v);
  saveState();
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
            saveState();
            updateHUD();
            renderGrid(map.getBounds());

            if (inHand >= TARGET) {
              console.log("Victory: picked up", inHand);
              alert(
                `Victory! You’ve reached ${inHand}!\nYou found a token you crafted earlier.\n\nPress OK to play again.`,
              );
              localStorage.removeItem(STORAGE_KEY);
              location.reload();
            }
          }
          return;
        }
        if (cv === inHand && cv > 0) {
          const newVal = inHand * 2;
          setCellValue(i, j, newVal);
          inHand = null;
          saveState();
          updateHUD();
          renderGrid(map.getBounds());
          if (newVal >= TARGET) {
            console.log("Victory: crafted", newVal);
            alert(
              `Victory! You’ve reached ${newVal}!\nYou crafted a new high-value token.`,
            );
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
  playerMarker.setLatLng(cellCenter(playerIJ.i, playerIJ.j));

  const bounds = map.getBounds();
  const range = INTERACT_RANGE * CELL_DEG;
  const northBound = bounds.getNorth() - range;
  const southBound = bounds.getSouth() + range;
  const westBound = bounds.getWest() + range;
  const eastBound = bounds.getEast() - range;

  let edgeLatLng: leaflet.LatLng | null = null;
  const playerLatLng = leaflet.latLng(cellCenter(playerIJ.i, playerIJ.j));

  if (playerLatLng.lat > northBound) {
    edgeLatLng = leaflet.latLng(playerLatLng.lat - range, playerLatLng.lng);
  } else if (playerLatLng.lat < southBound) {
    edgeLatLng = leaflet.latLng(playerLatLng.lat + range, playerLatLng.lng);
  } else if (playerLatLng.lng < westBound) {
    edgeLatLng = leaflet.latLng(playerLatLng.lat, playerLatLng.lng + range);
  } else if (playerLatLng.lng > eastBound) {
    edgeLatLng = leaflet.latLng(playerLatLng.lat, playerLatLng.lng - range);
  }

  if (edgeLatLng) {
    map.panTo(edgeLatLng);
  }

  renderGrid(map.getBounds());
  updateHUD();
  saveState();
}

function mkBtn(text: string, onClick: () => void) {
  const b = document.createElement("button");
  b.textContent = text;
  b.addEventListener("click", onClick);
  controls.appendChild(b);
}

mkBtn("↑ N", () => movePlayer(+1, 0));
mkBtn("↓ S", () => movePlayer(-1, 0));
mkBtn("← W", () => {
  movePlayer(0, -1);
});
mkBtn("→ E", () => {
  movePlayer(0, +1);
});
mkBtn("Center", () => map.setView(playerMarker.getLatLng()));
mkBtn("New Game", () => {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

renderGrid(map.getBounds());
updateHUD();
map.on("moveend", () => renderGrid(map.getBounds()));
