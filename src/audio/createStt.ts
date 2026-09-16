import { isNativeApp } from '../platform';
import { Stt, type SttEngine } from './stt';
import { NativeStt } from './sttNative';

export function createStt(): SttEngine {
  return isNativeApp() ? new NativeStt() : new Stt();
}
