import { otpEmail, otpSmsText } from './otp-message';

const dispatch = {
  channel: 'sms' as const,
  destination: '+237699000000',
  code: '123456',
  purpose: 'sign-in',
  expiresInSeconds: 300,
};

/** Alphabet GSM-7 de base (sans l'extension) : un SMS reste un seul segment de 160 caractères. */
const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

describe('OTP messages', () => {
  it('fits one GSM-7 SMS segment with the code and its validity', () => {
    const text = otpSmsText(dispatch);
    expect(text).toContain('123456');
    expect(text).toContain('5 min');
    expect(text.length).toBeLessThanOrEqual(160);
    const outside: string[] = [];
    for (const char of text) if (!GSM7.includes(char)) outside.push(char);
    expect(outside).toEqual([]);
  });

  it('writes a plain-text French e-mail with a subject per purpose', () => {
    expect(otpEmail({ ...dispatch, channel: 'email' })).toMatchObject({
      subject: 'Votre code de connexion Voxlivre',
    });
    expect(otpEmail({ ...dispatch, purpose: 'other' }).subject).toBe('Votre code Voxlivre');
    const { text } = otpEmail(dispatch);
    expect(text).toContain('123456');
    expect(text).toContain('5 minutes');
    expect(text).not.toMatch(/https?:/); // aucun lien (délivrabilité, hameçonnage)
  });
});
