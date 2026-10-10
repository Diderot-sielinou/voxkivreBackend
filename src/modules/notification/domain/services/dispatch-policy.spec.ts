import {
  crossesDailyAlert,
  MAX_PER_DESTINATION_PER_HOUR,
  oneHourBefore,
  refusalFor,
  startOfUtcDay,
} from './dispatch-policy';

describe('dispatch policy', () => {
  const base = {
    channel: 'sms' as const,
    sentToDestinationLastHour: 0,
    smsSentToday: 0,
    smsDailyLimit: 300,
  };

  it('allows up to 3 codes per destination per hour, on both channels', () => {
    expect(
      refusalFor({ ...base, sentToDestinationLastHour: MAX_PER_DESTINATION_PER_HOUR - 1 }),
    ).toBeNull();
    expect(refusalFor({ ...base, sentToDestinationLastHour: MAX_PER_DESTINATION_PER_HOUR })).toBe(
      'destination_hourly_limit',
    );
    expect(
      refusalFor({
        ...base,
        channel: 'email',
        sentToDestinationLastHour: MAX_PER_DESTINATION_PER_HOUR,
      }),
    ).toBe('destination_hourly_limit');
  });

  it('caps SMS per UTC day, never e-mails', () => {
    expect(refusalFor({ ...base, smsSentToday: 299 })).toBeNull();
    expect(refusalFor({ ...base, smsSentToday: 300 })).toBe('sms_daily_limit');
    expect(refusalFor({ ...base, channel: 'email', smsSentToday: 10_000 })).toBeNull();
  });

  it('alerts exactly once, when 80 % of the daily cap is crossed', () => {
    expect(crossesDailyAlert(239, 300)).toBe(false);
    expect(crossesDailyAlert(240, 300)).toBe(true);
    expect(crossesDailyAlert(241, 300)).toBe(false);
  });

  it('computes the windows', () => {
    const now = new Date('2026-10-10T22:30:00Z');
    expect(oneHourBefore(now).toISOString()).toBe('2026-10-10T21:30:00.000Z');
    expect(startOfUtcDay(now).toISOString()).toBe('2026-10-10T00:00:00.000Z');
  });
});
