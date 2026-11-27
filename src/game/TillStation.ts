// Till station — an invisible zone volume on the cashier (+Z) side of the
// checkout counter. The main loop polls isPlayerInside() every frame and
// decides what E does there (open the till while a customer is waiting at
// it, or close up once the day is over and the store is empty).
import type * as THREE from "three";
import { TILL_ZONE } from "./storeGeometry";

// The zone sits on the cashier (+Z) side of the player's counter (see
// storeGeometry.TILL_ZONE). It is generous on purpose — walking up to the
// till and pressing E should always work (cozy, no fiddly aiming).
export class TillStation {
  private readonly minX = TILL_ZONE.minX;
  private readonly maxX = TILL_ZONE.maxX;
  private readonly minZ = TILL_ZONE.minZ;
  private readonly maxZ = TILL_ZONE.maxZ;

  /**
   * True when the player is inside the till zone. Y is deliberately ignored
   * — the player's eye height is constant, so XZ containment is the question.
   */
  isPlayerInside(pos: THREE.Vector3): boolean {
    return pos.x >= this.minX && pos.x <= this.maxX && pos.z >= this.minZ && pos.z <= this.maxZ;
  }
}
