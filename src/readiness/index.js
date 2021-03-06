import EventEmitter from 'events';
import tracker from '../utils/timeTracker';

const SPLITS_READY = 2;
const SEGMENTS_READY = 4;
const SDK_FIRE_READY = SPLITS_READY | SEGMENTS_READY; // 2 + 4 = 6
const SDK_NOTIFY_UPDATE_SINCE_NOW = 8;
const SDK_FIRE_UPDATE = SDK_FIRE_READY | SDK_NOTIFY_UPDATE_SINCE_NOW; // 6 + 8 = 14

const Events = {
  SDK_READY_TIMED_OUT: 'init::timeout',
  SDK_READY: 'init::ready',
  SDK_SPLITS_ARRIVED: 'state::splits-arrived',
  SDK_SEGMENTS_ARRIVED: 'state::segments-arrived',
  SDK_UPDATE: 'state::update',
  READINESS_GATE_CHECK_STATE: 'state::check',
  READINESS_GATE_DESTROY: 'state::destroy'
};

/**
 * Machine state to handle the ready / update event propagation.
 */
function GateContext() {
  // Splits are shared through all instances of the same SDK.
  let splitsStatus = 0;
  const splits = new EventEmitter();
  splits.SDK_SPLITS_ARRIVED = Events.SDK_SPLITS_ARRIVED;
  // references counter: how many
  let refCount = 0;

  function ReadinessGateFactory(splits, segments, timeout) {
    const gate = new EventEmitter();
    let segmentsStatus = 0;
    let status = 0;
    let readinessTimeout;

    if (timeout > 0) {
      readinessTimeout = setTimeout(() => {
        if (status < SDK_FIRE_READY)
          gate.emit(
            Events.SDK_READY_TIMED_OUT,
            'Split SDK emitted SDK_READY_TIMED_OUT event.'
          );
      }, timeout);
    }

    gate.on(Events.READINESS_GATE_DESTROY, () => {
      clearTimeout(readinessTimeout);
    });

    gate.on(Events.READINESS_GATE_CHECK_STATE, () => {
      if (
        status !== SDK_FIRE_UPDATE &&
        splitsStatus + segmentsStatus === SDK_FIRE_READY
      ) {
        status = SDK_FIRE_UPDATE;
        gate.emit(Events.SDK_READY);
      } else if (status === SDK_FIRE_UPDATE) {
        gate.emit(Events.SDK_UPDATE);
      }
    });

    splits.on(Events.SDK_SPLITS_ARRIVED, () => {
      tracker.stop(tracker.TaskNames.SPLITS_READY);
      splitsStatus = SPLITS_READY;
      gate.emit(Events.READINESS_GATE_CHECK_STATE);
    });

    segments.on(Events.SDK_SEGMENTS_ARRIVED, () => {
      tracker.stop(tracker.TaskNames.SEGMENTS_READY);
      segmentsStatus = SEGMENTS_READY;
      gate.emit(Events.READINESS_GATE_CHECK_STATE);
    });

    return gate;
  }

  /**
   * SDK Readiness Gate Factory
   *
   * The ready state in the browser relay on sharing the splits ready flag across
   * all the gates, and have an extra flag for the segments which is per gate
   * instance.
   */
  function SDKReadinessGateFactory(timeout = 0) {
    const segments = new EventEmitter();
    segments.SDK_SEGMENTS_ARRIVED = Events.SDK_SEGMENTS_ARRIVED;

    const gate = ReadinessGateFactory(splits, segments, timeout);
    gate.SDK_READY = Events.SDK_READY;
    gate.SDK_UPDATE = Events.SDK_UPDATE;
    gate.SDK_READY_TIMED_OUT = Events.SDK_READY_TIMED_OUT;

    // New Gate has been created, so increase the counter
    refCount++;

    return {
      // Emitters
      splits,
      segments,
      gate,
      // Cleanup listeners
      destroy() {
        gate.emit(Events.READINESS_GATE_DESTROY);
        segments.removeAllListeners();
        gate.removeAllListeners();

        if (refCount > 0) refCount--;
        if (refCount === 0) splits.removeAllListeners();
      }
    };
  }

  return SDKReadinessGateFactory;
}

export default GateContext;
