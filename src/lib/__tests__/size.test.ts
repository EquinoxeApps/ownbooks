import { formatSize } from '../size';

describe('formatSize', () => {
  it('picks a decimal unit', () => {
    expect(formatSize(460_000_000)).toEqual({ value: 460, unit: 'MB' });
    expect(formatSize(1_250_000_000)).toEqual({ value: 1.3, unit: 'GB' });
    expect(formatSize(350_000)).toEqual({ value: 350, unit: 'KB' });
    expect(formatSize(10)).toEqual({ value: 1, unit: 'KB' });
  });
});
