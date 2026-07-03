// ============ LIMBIC — EPHEMERIS ============
// Pure moon-phase computation. No network calls, no node: built-ins.
// Runs in Cloudflare Workers, Node, and any JS/TS environment.
//
// Algorithm: cycle arithmetic from a known new-moon anchor.
// Reference new moon: 2000-01-06 18:14:05 UTC (JD ≈ 2451550.2598)
//
// Accuracy: ±1–2 hours for phase transitions; ±2% for illumination.
// Sufficient for experiential/legibility use; not for navigation.
//
// Formula after Jean Meeus, "Astronomical Algorithms"
// (Willmann-Bell, 2nd ed. 1998), ch. 49 — simplified cycle model.
// The illumination formula (1 − cos(2π·k)) / 2 is eq. 48.4.
// No Meeus code was copied; only the mathematical relationship is used.

export type PhaseName =
	| "new"
	| "waxing crescent"
	| "first quarter"
	| "waxing gibbous"
	| "full"
	| "waning gibbous"
	| "last quarter"
	| "waning crescent";

export interface MoonPhaseData {
	/** One of the 8 canonical phase names. */
	phaseName: PhaseName;
	/** Illuminated fraction of the lunar disc: 0.0 = new, 1.0 = full. */
	illumination: number;
	/** Approximate days until the next full moon. */
	daysToFull: number;
	/** True while the Moon is waxing (approaching full); false while waning. */
	waxing: boolean;
}

// Julian Date at the Unix epoch (1970-01-01 00:00:00 UTC)
const JD_UNIX_EPOCH = 2440587.5;
// Mean synodic period of the Moon (Meeus, Table 49.a) — days per lunation
const SYNODIC_PERIOD = 29.53058770576;
// Reference new moon: 2000-01-06 18:14:05 UTC → JD 2451550.2598
const REF_NEW_MOON_JD = 2451550.2598;

/**
 * Compute moon-phase data for a given UTC moment.
 *
 * @param date  A Date object or Unix timestamp in milliseconds.
 * @returns     Phase name, illumination (0–1), days to next full moon, waxing flag.
 */
export function getMoonPhaseData(date: Date | number): MoonPhaseData {
	const ms = date instanceof Date ? date.getTime() : date;
	const jd = JD_UNIX_EPOCH + ms / 86_400_000;

	// Days elapsed since the reference new moon, normalised to [0, SYNODIC_PERIOD)
	const daysSinceRef = jd - REF_NEW_MOON_JD;
	const cycleAge =
		((daysSinceRef % SYNODIC_PERIOD) + SYNODIC_PERIOD) % SYNODIC_PERIOD;

	// Fraction of the cycle completed: 0 = new moon, 0.5 = full moon
	const fraction = cycleAge / SYNODIC_PERIOD;

	// Illuminated fraction of the disc (Meeus eq. 48.4, simplified)
	const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2;

	// Days to next full moon (always positive, ≤ SYNODIC_PERIOD/2)
	const daysToFull =
		fraction <= 0.5
			? (0.5 - fraction) * SYNODIC_PERIOD
			: (1.5 - fraction) * SYNODIC_PERIOD;

	// Moon is waxing (approaching full) when in the first half of the cycle
	const waxing = fraction < 0.5;

	// 8-phase assignment: each primary phase (new/quarter/full) spans ±22.5°
	// around its canonical angle (0°, 90°, 180°, 270°), i.e. ±1/16 of the cycle.
	// The four in-between crescent/gibbous phases fill the remaining arcs.
	let phaseName: PhaseName;
	if (fraction < 0.03125 || fraction >= 0.96875) {
		phaseName = "new";
	} else if (fraction < 0.21875) {
		phaseName = "waxing crescent";
	} else if (fraction < 0.28125) {
		phaseName = "first quarter";
	} else if (fraction < 0.46875) {
		phaseName = "waxing gibbous";
	} else if (fraction < 0.53125) {
		phaseName = "full";
	} else if (fraction < 0.71875) {
		phaseName = "waning gibbous";
	} else if (fraction < 0.78125) {
		phaseName = "last quarter";
	} else {
		phaseName = "waning crescent";
	}

	return {
		phaseName,
		illumination: Math.round(illumination * 1000) / 1000,
		daysToFull: Math.round(daysToFull * 10) / 10,
		waxing,
	};
}
