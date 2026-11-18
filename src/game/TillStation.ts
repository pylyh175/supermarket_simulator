// Till station — an invisible zone volume on the cashier (+Z) side of the
// checkout counter. The main loop polls isPlayerInside() every frame and
// decides what E/Space does there (open the till while a customer is
// waiting). This class owns the zone bounds and the ServingState machine;
// the transition into "serving" itself happens in customers3d.ts.
import type * as THREE from "three";
import { TILL_X, TILL_Z } from "../three/storeLayout";

/**
 * Where a customer is in the serve flow. Task 7 drives the close of the
 * till overlay, which flips "serving" → "walking-out" (via
 * Customers3D.completeService()).
 */
export type ServingState = "walking-in" | "waiting" | "walking-out" | "serving";

// The counter spans roughly z ∈ [TILL_Z - 0.45, TILL_Z + 0.45]; the cashier
// side starts just past that. The zone is generous on purpose — walking up
// to the till and pressing E should always work (cozy, no fiddly aiming).
const ZONE_HALF_WIDTH_M = 0.95; // x around TILL_X
const ZONE_MIN_Z = TILL_Z + 0.5; // just past the counter's south face
const ZONE_MAX_Z = TILL_Z + 1.9; // covers the spawn spot in front of the till

export class TillStation {
  private readonly minX = TILL_X - ZONE_HALF_WIDTH_M;
  private readonly maxX = TILL_X + ZONE_HALF_WIDTH_M;
  private readonly minZ = ZONE_MIN_Z;
  private readonly maxZ = ZONE_MAX_Z;

  /**
   * True when the player is inside the till zone. Y is deliberately ignored
   * — the player's eye height is constant, so XZ containment is the question.
   */
  isPlayerInside(pos: THREE.Vector3): boolean {
    return pos.x >= this.minX && pos.x <= this.maxX && pos.z >= this.minZ && pos.z <= this.maxZ;
  }
}
