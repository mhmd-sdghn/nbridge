import type { BridgePlatform, PlatformInfo } from "../types";
import type { BridgeLogger } from "../utils/helpers";
import { getPlatformInfo } from "../utils/platform";
import {
  AndroidAdapter,
  IframeAdapter,
  IOSAdapter,
  type IPlatformAdapter,
  WebAdapter,
} from "./adapters";

export class PlatformDetector {
  constructor(
    private androidInterface: string,
    private iosHandler: string,
    private webLoopback: boolean = false,
    private logger?: BridgeLogger,
    private iframeParentOrigin?: string,
  ) {}

  public getPlatformInfo(): PlatformInfo {
    return getPlatformInfo(this.androidInterface, this.iosHandler);
  }

  public createAdapter(): IPlatformAdapter {
    const adapters = this.getAllAdapters();

    for (const adapter of adapters) {
      if (adapter.isAvailable()) {
        return adapter;
      }
    }

    return new WebAdapter(this.webLoopback, this.logger);
  }

  public getAdapterForPlatform(platform: BridgePlatform): IPlatformAdapter {
    switch (platform) {
      case "android":
        return new AndroidAdapter(this.androidInterface, this.logger);
      case "ios":
        return new IOSAdapter(this.iosHandler, this.logger);
      case "iframe":
        return new IframeAdapter(this.logger, this.iframeParentOrigin);
      case "web":
        return new WebAdapter(this.webLoopback, this.logger);
      default:
        throw new Error(`Unknown platform: ${platform}`);
    }
  }

  private getAllAdapters(): IPlatformAdapter[] {
    return [
      new AndroidAdapter(this.androidInterface, this.logger),
      new IOSAdapter(this.iosHandler, this.logger),
      new IframeAdapter(this.logger, this.iframeParentOrigin),
      new WebAdapter(this.webLoopback, this.logger),
    ];
  }

  public isPlatformAvailable(platform: BridgePlatform): boolean {
    const adapter = this.getAdapterForPlatform(platform);
    return adapter.isAvailable();
  }
}
