// Mohali Room Finder — search configuration.
// Change these values to adjust the search; nothing else needs editing.

export const REFERENCE = {
  name: "CP67 Mall, Sector 67, Mohali, Punjab",
  // Coordinates of a store inside CP67 Mall (published store locator), used as the mall's position.
  lat: 30.677784,
  lng: 76.723076,
};

export const RADIUS_KM = 5;
export const MIN_RENT = 1;
export const MAX_RENT = 10000;

export const USER_AGENT =
  "MohaliRoomFinder/2.0 (+https://github.com/manpreet1singh2/thenightcrew-autopost; personal rental search, low rate)";

// Polite crawling: minimum gap between two requests to the same host.
export const MIN_GAP_MS = Number(process.env.ROOM_FINDER_GAP_MS ?? 2000);
export const REQUEST_TIMEOUT_MS = 20000;
export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = Number(process.env.ROOM_FINDER_BACKOFF_MS ?? 1000);

// Localities checked every run (closest to CP67) and on the slower "extended" sweep.
// Pages that do not exist on a site are reported as "not found" and skipped, never as listings.
export const CORE_LOCALITIES = ["sector-66", "sector-67", "sector-68", "sector-69", "sector-70", "sector-71", "sector-79", "sector-80"];
export const EXTENDED_LOCALITIES = [
  "sector-58", "sector-60", "sector-61", "sector-62", "sector-63", "sector-65", "sector-77", "sector-78", "sector-82",
  "phase-1", "phase-3", "phase-5", "phase-6", "phase-7", "phase-8", "phase-9", "phase-10", "phase-11",
  "sohana", "kumbra",
];
// The extended sweep (and slower sources) run at most this often, even though the workflow fires every 5 minutes.
export const EXTENDED_EVERY_MIN = 30;

// Detail pages give coordinates (verified distance). Fetch at most this many per run.
export const MAX_DETAIL_FETCHES = 20;
export const DETAIL_REFRESH_DAYS = 7;

// A listing not seen on a successfully re-checked page this many times is marked "not seen recently" (never deleted).
export const MISSING_RUNS_THRESHOLD = 3;

// Notification thresholds (for future Telegram/email channels).
export const PRICE_CHANGE_MIN_INR = 250;

export const OUT_DIR = "room-finder-output";
export const STATE_DIR = "room-finder-state";
export const STATE_FILE = `${STATE_DIR}/state.json`;
