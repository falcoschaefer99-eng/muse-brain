import { describe, expect, it } from "vitest";
import { getCircadianPhaseForDate } from "../src/helpers";

describe("circadian helpers", () => {
	it("uses Europe/Berlin daylight saving time in April", () => {
		const phase = getCircadianPhaseForDate("2026-04-09T06:30:00.000Z");

		expect(phase.hour).toBe(8);
		expect(phase.phase).toBe("morning");
	});

	it("uses CET in winter", () => {
		const phase = getCircadianPhaseForDate("2026-01-09T06:30:00.000Z");

		expect(phase.hour).toBe(7);
		expect(phase.phase).toBe("dawn");
	});
});
