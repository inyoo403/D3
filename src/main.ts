// @deno-types="npm:@types/leaflet"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./_leafletWorkaround.ts";
import luck from "./_luck.ts";
import "./style.css";
const playerIconUrl = new URL("./assets/player-icon.png", import.meta.url).href;

// --- Constants ---
const START_LATLNG = leaflet.latLng(
  36.997936938057016,
  -122.05703507501151,
);
const CELL_DEG = 1e-4;
const INTERACT_RANGE = 3;
const TARGET = 32;
const GAME_STORAGE_KEY = "d3_gameState";
const BASE_ICON_SIZE = 48;
const BASE_ZOOM = 19;

// --- Types ---
export type IJ = { i: number; j: number };

type GameState = {
  playerIJ: IJ;
  inHand: number | null;
  modifiedCells: Map<string, number>;
};

type PersistedState = {
  playerIJ: IJ;
  inHand: number | null;
  overrides: [string, number][];
};

type GameEvent =
  | { type: "none" }
  | { type: "victory"; mode: "pick" | "craft"; value: number };

// --- Utilities ---
function key(i: number, j: number) {
  return `${i},${j}`;
}

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

function getDefaultCellState(i: number, j: number): number {
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

// --- Game Model (no DOM / Leaflet) ---
class GameModel {
  private state: GameState;
  private readonly storageKey: string;
  private readonly target: number;

  constructor(initialIJ: IJ, storageKey = GAME_STORAGE_KEY, target = TARGET) {
    this.storageKey = storageKey;
    this.target = target;
    this.state = {
      playerIJ: initialIJ,
      inHand: null,
      modifiedCells: new Map<string, number>(),
    };
    this.load();
  }

  // --- Persistence ---
  private load() {
    const saved = typeof localStorage !== "undefined"
      ? localStorage.getItem(this.storageKey)
      : null;
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved) as PersistedState;
      const map = new Map<string, number>();
      if (Array.isArray(parsed.overrides)) {
        for (const [k, v] of parsed.overrides) {
          map.set(k, v);
        }
      }
      this.state = {
        playerIJ: parsed.playerIJ ?? this.state.playerIJ,
        inHand: parsed.inHand ?? null,
        modifiedCells: map,
      };
    } catch (e) {
      console.error("Failed to load state from localStorage:", e);
      localStorage.removeItem(this.storageKey);
    }
  }

  private save() {
    if (typeof localStorage === "undefined") return;
    const payload: PersistedState = {
      playerIJ: this.state.playerIJ,
      inHand: this.state.inHand,
      overrides: Array.from(this.state.modifiedCells.entries()),
    };
    localStorage.setItem(this.storageKey, JSON.stringify(payload));
  }

  clearSavedState() {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(this.storageKey);
  }

  // --- Accessors ---
  get playerIJ(): IJ {
    return this.state.playerIJ;
  }

  get inHand(): number | null {
    return this.state.inHand;
  }

  getCellState(i: number, j: number): number {
    const k = key(i, j);
    return this.state.modifiedCells.has(k)
      ? this.state.modifiedCells.get(k)!
      : getDefaultCellState(i, j);
  }

  private setModifiedCellState(i: number, j: number, v: number) {
    this.state.modifiedCells.set(key(i, j), v);
    this.save();
  }

  isNear(i: number, j: number): boolean {
    const { i: ip, j: jp } = this.state.playerIJ;
    return (
      Math.abs(i - ip) <= INTERACT_RANGE &&
      Math.abs(j - jp) <= INTERACT_RANGE
    );
  }

  // --- Player movement ---
  movePlayerToIJ(newIJ: IJ) {
    this.state.playerIJ = newIJ;
    this.save();
  }

  movePlayerBy(di: number, dj: number) {
    this.state.playerIJ = {
      i: this.state.playerIJ.i + di,
      j: this.state.playerIJ.j + dj,
    };
    this.save();
  }

  // --- Cell interaction logic (pick/combine) ---
  handleCellClick(i: number, j: number): GameEvent {
    if (!this.isNear(i, j)) {
      return { type: "none" };
    }

    const cv = this.getCellState(i, j);

    // Pick up
    if (this.state.inHand == null) {
      if (cv > 0) {
        this.setModifiedCellState(i, j, 0);
        this.state.inHand = cv;
        this.save();

        if (this.state.inHand >= this.target) {
          return {
            type: "victory",
            mode: "pick",
            value: this.state.inHand,
          };
        }
      }
      return { type: "none" };
    }

    // Combine
    if (cv === this.state.inHand && cv > 0) {
      const newVal = this.state.inHand * 2;
      this.setModifiedCellState(i, j, newVal);
      this.state.inHand = null;
      this.save();

      if (newVal >= this.target) {
        return {
          type: "victory",
          mode: "craft",
          value: newVal,
        };
      }
      return { type: "none" };
    }

    return { type: "none" };
  }
}

// --- View / Controller (Leaflet + DOM + geolocation) ---
class GameView {
  private readonly root: HTMLElement;
  private readonly model: GameModel;

  private hud: HTMLDivElement;
  private controls: HTMLDivElement;

  private map: leaflet.Map;
  private cellLayer: leaflet.LayerGroup;
  private labelLayer: leaflet.LayerGroup;
  private playerMarker: leaflet.Marker;

  private geoWatchId: number | null = null;
  private isGpsMode = false;
  private moveButtons: HTMLButtonElement[] = [];

  constructor(root: HTMLElement, model: GameModel) {
    this.root = root;
    this.model = model;

    this.hud = this.createHud();
    this.controls = this.createControls();
    this.map = this.createMap();

    // 먼저 pane/tile 설정
    this.setupPanesAndTiles();

    // 그 다음 레이어/마커 생성
    this.cellLayer = leaflet.layerGroup().addTo(this.map);
    this.labelLayer = leaflet.layerGroup().addTo(this.map);
    this.playerMarker = this.createPlayerMarker();

    this.updatePlayerIconSize();
    this.setupMapEvents();
    this.initializeMovementControls();

    this.renderGrid();
    this.updateHUD();
  }

  // --- DOM helpers ---
  private createHud(): HTMLDivElement {
    let hud = document.getElementById("hud") as HTMLDivElement | null;
    if (!hud) {
      hud = document.createElement("div");
      hud.id = "hud";
      this.root.appendChild(hud);
    }
    return hud;
  }

  private createControls(): HTMLDivElement {
    let controls = document.getElementById("controls") as
      | HTMLDivElement
      | null;
    if (!controls) {
      controls = document.createElement("div");
      controls.id = "controls";
      this.root.appendChild(controls);
    }
    return controls;
  }

  private ensureMapContainer(): HTMLDivElement {
    let el = document.getElementById("map") as HTMLDivElement | null;
    if (!el) {
      el = document.createElement("div");
      el.id = "map";
      this.root.appendChild(el);
    }
    return el;
  }

  // --- Map / markers ---
  private createMap(): leaflet.Map {
    const map = leaflet.map(this.ensureMapContainer(), {
      center: START_LATLNG,
      zoom: BASE_ZOOM,
      maxZoom: BASE_ZOOM,
      zoomControl: true,
      attributionControl: false,
      doubleClickZoom: false,
    });
    map.zoomControl.setPosition("topright");
    return map;
  }

  private setupPanesAndTiles() {
    const playerPane = this.map.createPane("player");
    playerPane.style.zIndex = "650";
    playerPane.style.pointerEvents = "none";

    const labelsPane = this.map.createPane("labels");
    labelsPane.style.zIndex = "660";
    labelsPane.style.pointerEvents = "none";

    leaflet
      .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        maxNativeZoom: 19,
      })
      .addTo(this.map);
  }

  private createPlayerMarker(): leaflet.Marker {
    const marker = leaflet.marker(
      cellCenter(this.model.playerIJ.i, this.model.playerIJ.j),
      {
        interactive: false,
        pane: "player",
      },
    );
    marker.addTo(this.map);
    return marker;
  }

  private updatePlayerIconSize() {
    const currentZoom = this.map.getZoom();
    const scaleFactor = Math.pow(2, currentZoom - BASE_ZOOM);
    const newSize = BASE_ICON_SIZE * scaleFactor;
    const newAnchor = newSize / 2;

    const newPlayerIcon = leaflet.icon({
      iconUrl: playerIconUrl,
      iconSize: [newSize, newSize],
      iconAnchor: [newAnchor, newAnchor],
      tooltipAnchor: [0, -newAnchor],
    });

    this.playerMarker.setIcon(newPlayerIcon);
  }

  private setupMapEvents() {
    this.map.on("moveend", () => this.renderGrid());
    this.map.on("zoomend", () => {
      this.updatePlayerIconSize();
      this.renderGrid();
    });
  }

  // --- HUD ---
  private updateHUD() {
    const { i, j } = this.model.playerIJ;
    const inHand = this.model.inHand;
    this.hud.textContent = `In hand: ${
      inHand == null ? "—" : inHand
    }  Pos: (${i}, ${j})  Target: ${TARGET}`;
  }

  // --- Rendering ---
  private renderGrid() {
    this.cellLayer.clearLayers();
    this.labelLayer.clearLayers();

    const zoom = this.map.getZoom();
    if (zoom < 18) {
      this.updateHUD();
      return;
    }
    const labelPx = Math.max(12, 12 + 4 * (zoom - 18));

    const bounds = this.map.getBounds();
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
        const near = this.model.isNear(i, j);
        const v = this.model.getCellState(i, j);
        const tint = tintColorFor(v);

        const rect = leaflet
          .rectangle(cellBounds(i, j), {
            color: near ? "#1f6feb" : "#888",
            weight: near ? 2 : 1,
            opacity: near ? 0.8 : 0.3,
            fill: true,
            fillColor: tint,
            fillOpacity: v > 0 ? (near ? 0.35 : 0.25) : (near ? 0.08 : 0.04),
          })
          .addTo(this.cellLayer);

        rect.on("click", () => this.handleCellClick(i, j));

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
          leaflet
            .marker(cellCenter(i, j), {
              icon,
              interactive: false,
              pane: "labels",
            })
            .addTo(this.labelLayer);
        }
      }
    }

    this.updateHUD();
  }

  private handleCellClick(i: number, j: number) {
    if (!this.model.isNear(i, j)) return;
    const event = this.model.handleCellClick(i, j);
    this.syncPlayerMarker();
    this.renderGrid();
    this.updateHUD();

    if (event.type === "victory") {
      if (event.mode === "pick") {
        alert(
          `🎉 Victory! You’ve reached ${event.value}!\nYou found a token you crafted earlier.\n\nPress OK to play again.`,
        );
      } else {
        alert(
          `🎉 Victory! You’ve reached ${event.value}!\nYou crafted a new high-value token.`,
        );
      }
      this.model.clearSavedState();
      location.reload();
    }
  }

  private syncPlayerMarker() {
    this.playerMarker.setLatLng(
      cellCenter(this.model.playerIJ.i, this.model.playerIJ.j),
    );
  }

  private panCameraIfNearEdge() {
    const bounds = this.map.getBounds();
    const range = INTERACT_RANGE * CELL_DEG;
    const northBound = bounds.getNorth() - range;
    const southBound = bounds.getSouth() + range;
    const westBound = bounds.getWest() + range;
    const eastBound = bounds.getEast() - range;

    let edgeLatLng: leaflet.LatLng | null = null;
    const playerLatLng = leaflet.latLng(
      cellCenter(this.model.playerIJ.i, this.model.playerIJ.j),
    );

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
      this.map.panTo(edgeLatLng);
    }
  }

  private syncAndRender(pan = true) {
    this.syncPlayerMarker();
    if (pan) this.panCameraIfNearEdge();
    this.renderGrid();
    this.updateHUD();
  }

  // --- Movement controls ---
  private mkBtn(
    text: string,
    onClick: () => void,
    className = "",
  ): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = text;
    b.addEventListener("click", onClick);
    if (className) b.classList.add(className);
    this.controls.appendChild(b);
    return b;
  }

  private initializeMovementControls() {
    // Buttons mode
    this.moveButtons.push(
      this.mkBtn("↑ N", () => this.movePlayer(+1, 0), "move-btn"),
    );
    this.moveButtons.push(
      this.mkBtn("↓ S", () => this.movePlayer(-1, 0), "move-btn"),
    );
    this.moveButtons.push(
      this.mkBtn("← W", () => this.movePlayer(0, -1), "move-btn"),
    );
    this.moveButtons.push(
      this.mkBtn("→ E", () => this.movePlayer(0, +1), "move-btn"),
    );
    this.moveButtons.push(
      this.mkBtn(
        "Center",
        () => this.map.setView(this.playerMarker.getLatLng()),
        "move-btn",
      ),
    );

    this.mkBtn("New Game", () => {
      this.model.clearSavedState();
      location.reload();
    });

    const switchModeBtn = this.mkBtn("Switch to GPS", () => {
      this.isGpsMode = !this.isGpsMode;
      if (this.isGpsMode) {
        console.log("GPS movement mode activated.");
        this.moveButtons.forEach((btn) => (btn.style.display = "none"));
        this.startGeoMovement();
        switchModeBtn.textContent = "Switch to Buttons";
      } else {
        console.log("Button movement mode activated.");
        this.moveButtons.forEach((btn) => (btn.style.display = "flex"));
        this.stopGeoMovement();
        switchModeBtn.textContent = "Switch to GPS";
      }
    });
  }

  private movePlayer(di: number, dj: number) {
    this.model.movePlayerBy(di, dj);
    this.syncAndRender(true);
  }

  // --- Geolocation movement ---
  private startGeoMovement() {
    if (!("geolocation" in navigator)) {
      console.error("Geolocation is not supported by this browser.");
      return;
    }
    if (this.geoWatchId !== null) return;

    this.geoWatchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        const newIJ = toIJ(latitude, longitude);
        const curr = this.model.playerIJ;
        if (newIJ.i !== curr.i || newIJ.j !== curr.j) {
          this.model.movePlayerToIJ(newIJ);
          this.syncAndRender(true);
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

  private stopGeoMovement() {
    if (this.geoWatchId !== null) {
      navigator.geolocation.clearWatch(this.geoWatchId);
      this.geoWatchId = null;
    }
  }
}

// --- Public bootstrap API ---
export function createGame(root: HTMLElement = document.body) {
  const initialIJ = toIJ(START_LATLNG.lat, START_LATLNG.lng);
  const model = new GameModel(initialIJ);
  const view = new GameView(root, model);
  return { model, view };
}

// --- Auto-boot in browser (no `window` usage for Deno lint) ---
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      createGame();
    });
  } else {
    createGame();
  }
}
