import { missingParts, MULTIPART_PART_SIZE_BYTES, planParts, usesMultipart } from './multipart';

const MIB = 1024 * 1024;

describe('multipart (ADR-0029)', () => {
  it('uses parts only when asked and above one part', () => {
    expect(usesMultipart(12 * MIB, true)).toBe(true);
    expect(usesMultipart(5 * MIB, true)).toBe(false);
    expect(usesMultipart(12 * MIB, false)).toBe(false);
  });

  it('plans 5 MiB parts, the last one with the rest', () => {
    expect(MULTIPART_PART_SIZE_BYTES).toBe(5 * MIB);
    expect(planParts(12 * MIB)).toEqual([
      { partNumber: 1, sizeBytes: 5 * MIB },
      { partNumber: 2, sizeBytes: 5 * MIB },
      { partNumber: 3, sizeBytes: 2 * MIB },
    ]);
    expect(planParts(10 * MIB)).toHaveLength(2);
    expect(planParts(50 * 1000 * 1000)).toHaveLength(10);
    expect(planParts(1)).toEqual([{ partNumber: 1, sizeBytes: 1 }]);
  });

  it('lists the parts still to send, including a truncated one', () => {
    const plan = planParts(12 * MIB);
    expect(missingParts(plan, [])).toEqual(plan);
    expect(
      missingParts(plan, [
        { partNumber: 1, sizeBytes: 5 * MIB },
        { partNumber: 2, sizeBytes: 1000 },
        { partNumber: 7, sizeBytes: 5 * MIB },
      ]).map((p) => p.partNumber),
    ).toEqual([2, 3]);
    expect(
      missingParts(
        plan,
        plan.map((p) => ({ partNumber: p.partNumber, sizeBytes: p.sizeBytes })),
      ),
    ).toEqual([]);
  });
});
