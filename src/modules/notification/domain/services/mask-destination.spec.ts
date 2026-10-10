import { maskDestination } from './mask-destination';

describe('maskDestination', () => {
  it('keeps only what helps an operator, never the full value', () => {
    expect(maskDestination('+237699000012')).toBe('+2376••••••12');
    expect(maskDestination('alice@gmail.com')).toBe('a•••@gmail.com');
    expect(maskDestination('12345')).toBe('•••••');
  });
});
