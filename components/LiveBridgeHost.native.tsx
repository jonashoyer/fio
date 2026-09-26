import * as Crypto from 'expo-crypto';
import { useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import WebView from 'react-native-webview';
import { LIVE_BRIDGE_URL, liveWebViewVoiceService } from '@/lib/fio/voice-service.native';

function newBridgeId(): string {
  return Array.from(Crypto.getRandomBytes(24), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function LiveBridgeHost() {
  const [bridgeId] = useState(newBridgeId);
  const view = useRef<WebView>(null);
  useLayoutEffect(() => {
    liveWebViewVoiceService.attachBridge(bridgeId, (message) => {
      const payload = JSON.stringify(message);
      view.current?.injectJavaScript(
        `window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(payload)} })); true;`,
      );
    });
    return () => liveWebViewVoiceService.detachBridge(bridgeId);
  }, [bridgeId]);

  const trustedNavigation = (url: string): boolean => {
    if (url === 'about:blank') return true;
    try {
      const actual = new URL(url);
      const trusted = new URL(LIVE_BRIDGE_URL);
      return actual.origin === trusted.origin && actual.pathname === trusted.pathname &&
        actual.search === '' && (actual.hash === '' || actual.hash === `#${bridgeId}`);
    } catch { return false; }
  };

  return (
    <View pointerEvents="none" style={{ width: 1, height: 1, opacity: 0.01 }}>
      <WebView
        ref={view}
        source={{ uri: `${LIVE_BRIDGE_URL}#${bridgeId}` }}
        originWhitelist={['https://fioai.vercel.app']}
        onShouldStartLoadWithRequest={(request) => {
          const trusted = trustedNavigation(request.url);
          if (!trusted) liveWebViewVoiceService.reportBridgeLoad(bridgeId, 'blocked');
          return trusted;
        }}
        onLoadEnd={() => {
          liveWebViewVoiceService.reportBridgeLoad(bridgeId, 'loaded');
          view.current?.injectJavaScript(`window.ReactNativeWebView?.postMessage(JSON.stringify({
            channel: 'fio-live-bridge', bridge_id: location.hash.slice(1), type: 'host_probe',
            page_status: document.getElementById('status')?.textContent ?? ''
          })); true;`);
        }}
        onMessage={(event) => { void liveWebViewVoiceService.receiveBridgeMessage(event.nativeEvent.data); }}
        onError={() => liveWebViewVoiceService.reportBridgeLoad(bridgeId, 'failed')}
        onContentProcessDidTerminate={() => {
          liveWebViewVoiceService.reportBridgeLoad(bridgeId, 'failed');
          liveWebViewVoiceService.detachBridge(bridgeId);
        }}
        mediaCapturePermissionGrantType="prompt"
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
        javaScriptEnabled
        style={{ width: 1, height: 1, backgroundColor: 'transparent' }}
      />
    </View>
  );
}
