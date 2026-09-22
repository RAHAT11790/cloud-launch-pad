package app.lovable.d9496f6fadd2411c96f8fb97b0c234a7;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RsNativePlugin.class);
        super.onCreate(savedInstanceState);

        // True immersive: no notification bar, no navigation bar.
        RsNativePlugin.applyImmersive(this);

        // Reliable playback for plain http:// media servers.
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            settings.setDomStorageEnabled(true);
            settings.setJavaScriptCanOpenWindowsAutomatically(true);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) RsNativePlugin.applyImmersive(this);
    }

    @Override
    public void onResume() {
        super.onResume();
        RsNativePlugin.applyImmersive(this);
    }
}
