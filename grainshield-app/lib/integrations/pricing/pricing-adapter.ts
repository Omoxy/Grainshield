export interface PriceRecord {
  source: string;
  market: string;
  grainType: string;
  pricePerKg: number;
  currency: string;
  recordedAt: Date;
  confidence: number;
}

export interface PriceAdapter {
  readonly sourceId: string;
  readonly sourceName: string;
  fetchCurrentPrices(grainType?: string): Promise<PriceRecord[]>;
  isAvailable(): Promise<boolean>;
}
