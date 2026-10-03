import { describe, expect, it } from 'vitest';
import { bandChanged, queueBand, receiptDue } from '../receipt-need';

describe('queueBand', () => {
  it('maps ms to spec 6.1 queue bands', () => {
    expect(queueBand(149)).toBe(0);
    expect(queueBand(150)).toBe(1);
    expect(queueBand(400)).toBe(1);
    expect(queueBand(401)).toBe(2);
  });
});

describe('bandChanged', () => {
  it('detects changes in directions the server acts on', () => {
    expect(bandChanged(0, 150)).toBe(true);
    expect(bandChanged(150, 401)).toBe(true);
    expect(bandChanged(401, 150)).toBe(false);
    expect(bandChanged(150, 0)).toBe(true);
    expect(bandChanged(401, 0)).toBe(true);
    expect(bandChanged(0, 50)).toBe(false);
    expect(bandChanged(150, 200)).toBe(false);
  });
});

describe('receiptDue', () => {
  it('handles first landing, batching, window movements, and small windows', () => {
    expect(receiptDue(1, 40, -1)).toBe(true);
    expect(receiptDue(3, 40, 40)).toBe(false);
    expect(receiptDue(10, 40, 40)).toBe(true);
    expect(receiptDue(1, 30, 40)).toBe(true);
    expect(receiptDue(1, 39, 40)).toBe(false);
    expect(receiptDue(1, 8, 6)).toBe(true);
    expect(receiptDue(1, 7, 6)).toBe(false);
    expect(receiptDue(1, 4, 4)).toBe(true);
  });
});
