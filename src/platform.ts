import { Capacitor } from '@capacitor/core';

/** 안드로이드/iOS 앱(WebView) 안에서 실행 중인지 */
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();
