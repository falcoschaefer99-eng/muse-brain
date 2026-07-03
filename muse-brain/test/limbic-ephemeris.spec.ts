// ============ LIMBIC EPHEMERIS — UNIT TESTS ============
// Tests the pure moon-phase computation in src/limbic/ephemeris.ts.
//
// All dates are verified against real astronomical calendars:
//   2025-01-29 — new moon (multiple ephemeris sources confirm ~05:36–12:36 UTC)
//   2025-02-12 — near full moon (~14 days after Jan 29 new moon)
//   2025-02-05 — ~7 days into the Jan 29 cycle (first quarter zone, waxing)
//   2025-02-18 — ~20 days into the Jan 29 cycle (waning zone)

import { describe, expect, it } from "vitest";
import { getMoonPhaseData, type PhaseName } from "../src/limbic/ephemeris";

const ALL_PHASE_NAMES: PhaseName[] = [
	"new",
	"waxing crescent",
	"first quarter",
	"waxing gibbous",
	"full",
	"waning gibbous",
	"last quarter",
	"waning crescent",
];

describe("getMoonPhaseData — phase 0 (ephemeris module)", () => {
	// ---------------------------------------------------------------
	// New moon calibration
	// ---------------------------------------------------------------
	it("returns phaseName=new and illumination≈0 near the January 2025 new moon", () => {
		// 2025-01-29 is a known new moon (multiple ephemeris sources)
		const result = getMoonPhaseData(new Date("2025-01-29T12:00:00Z"));
		expect(result.phaseName).toBe("new");
		expect(result.illumination).toBeLessThan(0.05);
	});

	// ---------------------------------------------------------------
	// Full moon calibration
	// ---------------------------------------------------------------
	it("returns phaseName=full and illumination≈1 near the February 2025 full moon", () => {
		// ~14 days after the Jan 29 new moon → peak illumination around Feb 12–13
		const result = getMoonPhaseData(new Date("2025-02-12T13:53:00Z"));
		expect(result.phaseName).toBe("full");
		expect(result.illumination).toBeGreaterThan(0.95);
	});

	// ---------------------------------------------------------------
	// Pure-math check: exact half-cycle from the reference anchor
	// ---------------------------------------------------------------
	it("returns illumination=1.0 exactly at the reference half-cycle (full moon)", () => {
		// The algorithm is defined in terms of these constants — this is a tautological
		// check that the formula is correctly wired, not a real-world calibration.
		const SYNODIC = 29.53058770576;
		const refMs = new Date("2000-01-06T18:14:05Z").getTime();
		const halfCycleMs = refMs + (SYNODIC / 2) * 86_400_000;
		const result = getMoonPhaseData(halfCycleMs);
		expect(result.phaseName).toBe("full");
		expect(result.illumination).toBeGreaterThan(0.99);
	});

	// ---------------------------------------------------------------
	// Waxing flag
	// ---------------------------------------------------------------
	it("returns waxing=true midway between the January 2025 new moon and the February full moon", () => {
		// 2025-02-05 is ~7 days into the Jan 29 cycle — solidly waxing
		const result = getMoonPhaseData(new Date("2025-02-05T12:00:00Z"));
		expect(result.waxing).toBe(true);
		expect(result.illumination).toBeGreaterThan(0.3);
		expect(result.illumination).toBeLessThan(0.7);
	});

	it("returns waxing=false ~20 days after the January 2025 new moon", () => {
		// 2025-02-18 is ~20 days into the cycle — waning
		const result = getMoonPhaseData(new Date("2025-02-18T12:00:00Z"));
		expect(result.waxing).toBe(false);
		expect(["waning gibbous", "last quarter", "waning crescent"]).toContain(
			result.phaseName
		);
	});

	// ---------------------------------------------------------------
	// daysToFull sanity
	// ---------------------------------------------------------------
	it("returns daysToFull≈14.77 at a new moon", () => {
		const result = getMoonPhaseData(new Date("2025-01-29T12:00:00Z"));
		expect(result.daysToFull).toBeGreaterThan(14.0);
		expect(result.daysToFull).toBeLessThan(15.5);
	});

	it("returns daysToFull<1 within 24h before a full moon", () => {
		// One synodic half minus 0.5 days = just before the full moon
		const SYNODIC = 29.53058770576;
		const refMs = new Date("2000-01-06T18:14:05Z").getTime();
		const almostFullMs = refMs + (SYNODIC / 2 - 0.5) * 86_400_000;
		const result = getMoonPhaseData(almostFullMs);
		expect(result.daysToFull).toBeLessThan(1.0);
	});

	// ---------------------------------------------------------------
	// Return shape
	// ---------------------------------------------------------------
	it("always returns a well-formed MoonPhaseData object for an arbitrary date", () => {
		const result = getMoonPhaseData(new Date("2026-07-03T10:00:00Z"));
		expect(ALL_PHASE_NAMES).toContain(result.phaseName);
		expect(result.illumination).toBeGreaterThanOrEqual(0);
		expect(result.illumination).toBeLessThanOrEqual(1);
		expect(result.daysToFull).toBeGreaterThanOrEqual(0);
		// daysToFull is days to the NEXT full moon — max is ~1 full synodic period
		// (right after a full moon, the next one is ~29.53 days away)
		expect(result.daysToFull).toBeLessThanOrEqual(29.53058770576 + 0.1);
		expect(typeof result.waxing).toBe("boolean");
	});

	it("accepts a numeric timestamp as well as a Date object", () => {
		const d = new Date("2025-01-29T12:00:00Z");
		const fromDate = getMoonPhaseData(d);
		const fromMs = getMoonPhaseData(d.getTime());
		expect(fromDate).toEqual(fromMs);
	});
});
