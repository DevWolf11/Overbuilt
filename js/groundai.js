'use strict';
// Computer-driven ground vehicles (the ground update): the Tank Range's targets and the Practice Battle's allies
// and enemies. They are real Vessels with real parts, moved kinematically (cheap) instead of by the physics step.

const GroundAI = {
  battle: null, // the Practice Battle's state while one runs, else null
  frame(F, dt) {},
  kinStep(v, dt) {},
  down(v, F) {},
  reset(F) {},
  startRange(F) {},
  startBattle(F, opts) {},
  onDestroyed(F) { return false; },
};
