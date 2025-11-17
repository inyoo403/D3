// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./_leafletWorkaround.ts";
import luck from "./_luck.ts";
import playerIconUrl from "./assets/player-icon.png";
import "./style.css";

// --- Constants ---
const START_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);
const CELL_DEG = 1e-4;
const INTERACT_RANGE = 3;
const TARGET = 32;
// Key for localStorage.
const GAME_STORAGE_KEY = "d3_gameState";
const BASE_ICON_SIZE = 48;
const BASE_ZOOM = 19;

// --- DOM Elements ---
const hud = document.createElement("div");
hud.id = "hud";
document.body.appendChild(hud);

const controls = document.createElement("div");
controls.id = "controls";
document.body.appendChild(controls);

// --- Game State ---
let inHand: number | null = null;
let playerIJ: IJ = toIJ(START_LATLNG.lat, START_LATLNG.lng);
let geoWatchId: number | null = null;

// Flyweight: Stores intrinsic (modified) cell states.
const modifiedCells = new Map<string, number>();

// Creates a unique string key for a cell coordinate.
function key(i: number, j: number) {
  return `${i},${j}`;
}

// Memento: Saves the current game state to localStorage.
function saveGameState() {
  const state = {
    playerIJ: playerIJ,
    inHand: inHand,
    overrides: Array.from(modifiedCells.entries()),
  };
  localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify(state));
}

// Memento: Restores game state from localStorage.
function loadGameState() {
  const savedState = localStorage.getItem(GAME_STORAGE_KEY);
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
      modifiedCells.clear();
      for (const [key, value] of state.overrides) {
        modifiedCells.set(key, value);
      }
    }
  } catch (e) {
    console.error("Failed to load state from localStorage:", e);
    localStorage.removeItem(GAME_STORAGE_KEY);
  }
}

// --- UI and Map Setup ---

// Updates the top-left HUD text.
function updateHUD() {
  hud.textContent = `In hand: ${
    inHand == null ? "—" : inHand
  }  Pos: (${playerIJ.i}, ${playerIJ.j})  Target: ${TARGET}`;
}

// Ensures the map container div exists.
function ensureMapContainer(): HTMLDivElement {
  let el = document.getElementById("map") as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = "map";
    document.body.appendChild(el);
  }
  return el;
}

// Initialize the Leaflet map.
const map = leaflet.map(ensureMapContainer(), {
  center: START_LATLNG,
  zoom: BASE_ZOOM,
  maxZoom: BASE_ZOOM,
  zoomControl: true,
  attributionControl: false,
  doubleClickZoom: false,
});
map.zoomControl.setPosition("topright");

// Create map panes for layers.
const playerPane = map.createPane("player");
playerPane.style.zIndex = "650";
playerPane.style.pointerEvents = "none";

const labelsPane = map.createPane("labels");
labelsPane.style.zIndex = "660";
labelsPane.style.pointerEvents = "none";

// Add the base tile layer.
leaflet.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  maxNativeZoom: 19,
}).addTo(map);

// --- Coordinate and Cell Utilities ---

// Defines the (i, j) grid coordinate type.
export type IJ = { i: number; j: number };
// Converts geographic coordinates (lat/lng) to grid coordinates (i/j).
export function toIJ(lat: number, lng: number): IJ {
  return { i: Math.floor(lat / CELL_DEG), j: Math.floor(lng / CELL_DEG) };
}
// Returns the geographic bounds of a grid cell.
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
// Returns the geographic center of a grid cell.
export function cellCenter(i: number, j: number): leaflet.LatLngExpression {
  return [(i + 0.5) * CELL_DEG, (j + 0.5) * CELL_DEG];
}

// --- Player Setup ---
loadGameState();

// Create the player marker.
const playerMarker = leaflet
  .marker(cellCenter(playerIJ.i, playerIJ.j), {
    interactive: false,
    pane: "player",
  });
playerMarker.addTo(map);

// Adjusts player icon size based on map zoom level.
function updatePlayerIconSize() {
  const currentZoom = map.getZoom();
  const scaleFactor = Math.pow(2, currentZoom - BASE_ZOOM);
  const newSize = BASE_ICON_SIZE * scaleFactor;
  const newAnchor = newSize / 2;

  const newPlayerIcon = leaflet.icon({
    iconUrl: playerIconUrl,
    iconSize: [newSize, newSize],
    iconAnchor: [newAnchor, newAnchor],
    tooltipAnchor: [0, -newAnchor],
  });

  playerMarker.setIcon(newPlayerIcon);
}

// --- Flyweight Pattern ---

// Create layers for cells and labels.
const cellLayer = leaflet.layerGroup().addTo(map);
const labelLayer = leaflet.layerGroup().addTo(map);

// Flyweight: Calculates the extrinsic (shared, default) state for a cell.
function getDefaultCellState(i: number, j: number): number {
  const r = luck(`spawn:${i},${j}`);
  if (r < 0.25) return 1;
  if (r < 0.30) return 2;
  if (r < 0.32) return 4;
  return 0;
}
// Returns a color tint based on the token's value.
function tintColorFor(v: number): string {
  if (v <= 0) return "transparent";
  const level = Math.floor(Math.log2(v));
  const lightness = Math.max(35, 85 - level * 10);
  return `hsl(35 95% ${lightness})`;
}
// Flyweight: The factory, returning modified or default state.
function getCellState(i: number, j: number): number {
  const k = key(i, j);
  return modifiedCells.has(k)
    ? modifiedCells.get(k)!
    : getDefaultCellState(i, j);
}
// Flyweight: Sets the intrinsic (modified) state for a cell.
function setModifiedCellState(i: number, j: number, v: number) {
  modifiedCells.set(key(i, j), v);
  saveGameState();
}
// Checks if a cell is within the player's interaction range.
function isNear(i: number, j: number, ip: number, jp: number): boolean {
  return Math.abs(i - ip) <= INTERACT_RANGE &&
    Math.abs(j - jp) <= INTERACT_RANGE;
}

// Renders all visible cells, labels, and click handlers.
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
      const v = getCellState(i, j);

      const tint = tintColorFor(v);

      const rect = leaflet.rectangle(cellBounds(i, j), {
        color: near ? "#1f6feb" : "#888",
        weight: near ? 2 : 1,
        opacity: near ? 0.8 : 0.3,
        fill: true,
        fillColor: tint,
        fillOpacity: v > 0 ? (near ? 0.35 : 0.25) : (near ? 0.08 : 0.04),
      }).addTo(cellLayer);

      // --- Cell Click Handler ---
      rect.on("click", () => {
        if (!isNear(i, j, playerIJ.i, playerIJ.j)) return;
        const cv = getCellState(i, j);
        // --- Pick up ---
        if (inHand == null) {
          if (cv > 0) {
            setModifiedCellState(i, j, 0);
            inHand = cv;
            saveGameState();
            updateHUD();
            renderGrid(map.getBounds());

            if (inHand >= TARGET) {
              console.log("Victory: picked up", inHand);
              alert(
                `🎉 Victory! You’ve reached ${inHand}!\nYou found a token you crafted earlier.\n\nPress OK to play again.`,
              );
              localStorage.removeItem(GAME_STORAGE_KEY);
              location.reload();
            }
          }
          return;
        }
        // --- Combine ---
        if (cv === inHand && cv > 0) {
          const newVal = inHand * 2;
          setModifiedCellState(i, j, newVal);
          inHand = null;
          saveGameState();
          updateHUD();
          renderGrid(map.getBounds());
          if (newVal >= TARGET) {
            console.log("Victory: crafted", newVal);
            alert(
              `🎉 Victory! You’ve reached ${newVal}!\nYou crafted a new high-value token.`,
            );
          }
          return;
        }
      });

      // --- Add Number Label ---
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

// --- Movement ---

// Moves the player by a delta (di, dj) and updates state.
function movePlayer(di: number, dj: number) {
  playerIJ = { i: playerIJ.i + di, j: playerIJ.j + dj };
  panCameraToPlayer();
  renderGrid(map.getBounds());
  updateHUD();
  saveGameState();
}

// Pans the map camera if the player approaches the edge.
function panCameraToPlayer() {
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
}

// Starts tracking the user's GPS location.
function startGeoMovement() {
  if (!("geolocation" in navigator)) {
    console.error("Geolocation is not supported by this browser.");
    return;
  }
  if (geoWatchId !== null) return;

  geoWatchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      const newIJ = toIJ(latitude, longitude);

      if (newIJ.i !== playerIJ.i || newIJ.j !== playerIJ.j) {
        playerIJ = newIJ;
        panCameraToPlayer();
        renderGrid(map.getBounds());
        updateHUD();
        saveGameState();
      }
    },
    (error) => {
      console.error("Error getting geolocation:", error);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
    },
  );
}

// Stops tracking the user's GPS location.
function stopGeoMovement() {
  if (geoWatchId !== null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
}

// Helper function to create and append a new button.
function mkBtn(
  text: string,
  onClick: () => void,
  className: string = "",
): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = text;
  b.addEventListener("click", onClick);
  if (className) {
    b.classList.add(className);
  }
  controls.appendChild(b);
  return b;
}

// Facade: Sets up movement mode on load.
function initializeMovement() {
  const moveButtons: HTMLButtonElement[] = [];
  let isGpsMode = false;

  moveButtons.push(mkBtn("↑ N", () => movePlayer(+1, 0), "move-btn"));
  moveButtons.push(mkBtn("↓ S", () => movePlayer(-1, 0), "move-btn"));
  moveButtons.push(mkBtn("← W", () => movePlayer(0, -1), "move-btn"));
  moveButtons.push(mkBtn("→ E", () => movePlayer(0, +1), "move-btn"));
  moveButtons.push(
    mkBtn("Center", () => map.setView(playerMarker.getLatLng()), "move-btn"),
  );

  mkBtn("New Game", () => {
    localStorage.removeItem(GAME_STORAGE_KEY);
    location.reload();
  });

  const switchModeBtn = mkBtn("Switch to GPS", () => {
    isGpsMode = !isGpsMode;
    if (isGpsMode) {
      console.log("GPS movement mode activated.");
      moveButtons.forEach((btn) => (btn.style.display = "none"));
      startGeoMovement();
      switchModeBtn.textContent = "Switch to Buttons";
    } else {
      console.log("Button movement mode activated.");
      moveButtons.forEach((btn) => (btn.style.display = "flex"));
      stopGeoMovement();
      switchModeBtn.textContent = "Switch to GPS";
    }
  });
}

// --- Initialize Game ---
renderGrid(map.getBounds());
updateHUD();
updatePlayerIconSize();
map.on("moveend", () => renderGrid(map.getBounds()));
map.on("zoomend", updatePlayerIconSize);
initializeMovement();
