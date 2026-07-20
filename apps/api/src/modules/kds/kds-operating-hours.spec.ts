import {
  evaluateOperatingSchedule,
  isScheduleCovered,
  OperatingHour,
} from "./kds-operating-hours";
import { isOperatingHourOpenAt } from "../shared/weekly-operating-hours";

function time(value: string): Date {
  const [hour, minute] = value.split(":").map(Number);
  return new Date(Date.UTC(1970, 0, 1, hour, minute));
}

function hour(
  dayOfWeek: number,
  timeFrom: string,
  timeTo: string,
  isClosed = false,
): OperatingHour {
  return {
    dayOfWeek,
    timeFrom: time(timeFrom),
    timeTo: time(timeTo),
    isClosed,
  };
}

describe("KDS operating hours", () => {
  it("keeps a Sunday window open after midnight on Monday", () => {
    const result = evaluateOperatingSchedule(
      [hour(0, "09:30", "02:00")],
      "America/Toronto",
      new Date("2026-07-20T05:00:00.000Z"),
    );

    expect(result.isOpen).toBe(true);
    expect(result.currentWindow?.opensAt.toISOString()).toBe(
      "2026-07-19T13:30:00.000Z",
    );
    expect(result.currentWindow?.closesAt.toISOString()).toBe(
      "2026-07-20T06:00:00.000Z",
    );
  });

  it("treats closing as exclusive", () => {
    const result = evaluateOperatingSchedule(
      [hour(0, "09:30", "02:00")],
      "America/Toronto",
      new Date("2026-07-20T06:00:00.000Z"),
    );

    expect(result.isOpen).toBe(false);
  });

  it("treats equal opening and closing times as a full operating day", () => {
    const result = evaluateOperatingSchedule(
      [hour(1, "00:00", "00:00")],
      "America/Toronto",
      new Date("2026-07-20T16:00:00.000Z"),
    );

    expect(result.isOpen).toBe(true);
    expect(
      result.currentWindow!.closesAt.getTime() -
        result.currentWindow!.opensAt.getTime(),
    ).toBe(24 * 60 * 60 * 1_000);
  });

  it("aligns non-midnight equal times with ordering as a 24-hour window", () => {
    const sunday = hour(0, "09:00", "09:00");

    expect(
      isOperatingHourOpenAt(sunday, { dow: 0, hhmm: 8 * 60 + 59 }),
    ).toBe(false);
    expect(isOperatingHourOpenAt(sunday, { dow: 0, hhmm: 9 * 60 })).toBe(true);
    expect(
      isOperatingHourOpenAt(sunday, { dow: 1, hhmm: 8 * 60 + 59 }),
    ).toBe(true);
    expect(isOperatingHourOpenAt(sunday, { dow: 1, hhmm: 9 * 60 })).toBe(false);
  });

  it("supports same-day windows and closed days", () => {
    const result = evaluateOperatingSchedule(
      [hour(1, "09:00", "17:00"), hour(2, "09:00", "17:00", true)],
      "America/Toronto",
      new Date("2026-07-20T16:00:00.000Z"),
    );

    expect(result.isOpen).toBe(true);
    expect(result.currentWindow?.closesAt.toISOString()).toBe(
      "2026-07-20T21:00:00.000Z",
    );
    expect(result.nextWindow?.dayOfWeek).toBe(1);
  });

  it("wraps Sunday overnight coverage into Monday", () => {
    expect(
      isScheduleCovered(
        [hour(0, "23:00", "02:00")],
        [hour(0, "22:00", "03:00")],
      ),
    ).toBe(true);
  });

  it("uses Toronto daylight-saving boundaries", () => {
    const result = evaluateOperatingSchedule(
      [hour(0, "00:00", "04:00")],
      "America/Toronto",
      new Date("2026-03-08T06:00:00.000Z"),
    );

    expect(result.currentWindow?.opensAt.toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    expect(result.currentWindow?.closesAt.toISOString()).toBe(
      "2026-03-08T08:00:00.000Z",
    );
  });

  it("accepts KDS hours that fully cover overnight Store Hours", () => {
    expect(
      isScheduleCovered(
        [hour(0, "11:00", "01:00")],
        [hour(0, "09:30", "02:00")],
      ),
    ).toBe(true);
  });

  it("rejects KDS hours that close before Store Hours", () => {
    expect(
      isScheduleCovered(
        [hour(0, "11:00", "02:00")],
        [hour(0, "09:30", "01:00")],
      ),
    ).toBe(false);
  });

  it("supports coverage assembled from adjacent KDS windows", () => {
    expect(
      isScheduleCovered(
        [hour(0, "23:00", "02:00")],
        [hour(0, "22:00", "00:00"), hour(1, "00:00", "03:00")],
      ),
    ).toBe(true);
  });
});
