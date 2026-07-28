import { Injectable, OnModuleInit } from "@nestjs/common";
import { MediaAsset } from "../../entities/media-asset.entity";
import { MediaDerivative } from "../../entities/media-derivative.entity";
import { BackgroundRemovalService } from "./background-removal.service";
import { MediaProcessorRegistry } from "./media-processor.registry";

/**
 * Runs the ordered chain of registered processors for an asset. V1 registers the
 * background-removal stage; future stages (enhancement → shadow → thumbnail) are
 * appended without changing this service or any template (Workstream 14).
 */
@Injectable()
export class MediaPipelineService implements OnModuleInit {
  constructor(
    private readonly registry: MediaProcessorRegistry,
    private readonly backgroundRemoval: BackgroundRemovalService,
  ) {}

  onModuleInit() {
    // Register the V1 stage. Additional stages register here in future work.
    this.registry.register(this.backgroundRemoval);
  }

  /** Execute every registered stage in order and return the produced derivatives. */
  async run(asset: MediaAsset): Promise<MediaDerivative[]> {
    const results: MediaDerivative[] = [];
    for (const stage of this.registry.ordered()) {
      results.push(await stage.process(asset));
    }
    return results;
  }
}
