import type pako from "pako";
import type { CompressionConfig, CompressionStats } from "../types";
import { type BridgeLogger, byteLength } from "../utils/helpers";

export class CompressionManager {
  private stats: CompressionStats = {
    totalCompressed: 0,
    bytesBeforeCompression: 0,
    bytesAfterCompression: 0,
    averageCompressionRatio: 0,
  };
  // Lazy-loaded so pako (~45KB) stays out of the initial module graph for the
  // majority of apps that never enable compression and whose hosts never send
  // compressed payloads. Loaded on first compress()/decompress().
  private pakoPromise: Promise<typeof pako> | null = null;

  constructor(
    private logger: BridgeLogger,
    private config: Required<CompressionConfig>,
  ) {}

  private loadPako(): Promise<typeof pako> {
    if (!this.pakoPromise) {
      this.pakoPromise = import("pako").then((m) => m.default ?? m);
    }
    return this.pakoPromise;
  }

  /**
   * Compress data to base64 string
   * Only compresses if data exceeds threshold
   *
   * @param data - Data to compress
   * @returns Compressed base64 string or null if below threshold
   */
  public async compress(data: unknown): Promise<string | null> {
    try {
      const json = JSON.stringify(data);
      const originalSize = byteLength(json);

      if (originalSize < this.config.threshold) {
        this.logger.log(
          `Payload size (${originalSize}B) below compression threshold (${this.config.threshold}B)`,
        );
        return null;
      }

      const pako = await this.loadPako();
      const compressed = pako.deflate(json);
      const base64 = this.uint8ArrayToBase64(compressed);
      const compressedSize = byteLength(base64);

      // base64 adds ~33% overhead, so incompressible payloads (already-encoded
      // images, random tokens) come out LARGER. Fall back to the uncompressed
      // form rather than shipping a bigger wire message.
      if (compressedSize >= originalSize) {
        this.logger.log(
          `Compression skipped: result (${compressedSize}B) not smaller than original (${originalSize}B)`,
        );
        return null;
      }

      if (this.config.trackStats) {
        this.updateStats(originalSize, compressedSize);
      }

      this.logger.log(
        `Compressed payload: ${originalSize}B → ${compressedSize}B (${((compressedSize / originalSize) * 100).toFixed(1)}%)`,
      );

      return base64;
    } catch (error) {
      this.logger.error("Compression failed:", error);
      return null;
    }
  }

  /**
   * Decompress base64 string back to original data
   *
   * @param compressed - Compressed base64 string
   * @returns Decompressed data
   * @throws Error if decompression fails
   */
  public async decompress(compressed: string): Promise<unknown> {
    try {
      const pako = await this.loadPako();
      const bytes = this.base64ToUint8Array(compressed);
      const decompressed = pako.inflate(bytes, { to: "string" });
      return JSON.parse(decompressed);
    } catch (error) {
      this.logger.error("Decompression failed:", error);
      throw new Error(
        `Failed to decompress payload: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("base64");
    }

    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(base64, "base64"));
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  private updateStats(originalSize: number, compressedSize: number): void {
    this.stats.totalCompressed++;
    this.stats.bytesBeforeCompression += originalSize;
    this.stats.bytesAfterCompression += compressedSize;

    this.stats.averageCompressionRatio =
      this.stats.bytesAfterCompression / this.stats.bytesBeforeCompression;
  }

  public getStats(): CompressionStats {
    return { ...this.stats };
  }

  public resetStats(): void {
    this.stats = {
      totalCompressed: 0,
      bytesBeforeCompression: 0,
      bytesAfterCompression: 0,
      averageCompressionRatio: 0,
    };
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public getThreshold(): number {
    return this.config.threshold;
  }

  public destroy(): void {
    this.resetStats();
  }
}
