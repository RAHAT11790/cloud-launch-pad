package app.lovable.d9496f6fadd2411c96f8fb97b0c234a7;

import android.app.Activity;
import android.content.Context;
import android.media.AudioManager;
import android.os.Build;
import android.provider.Settings;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.content.pm.ActivityInfo;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native system controls for the RS ANIME03 Android app:
 * immersive fullscreen (status + navigation bar), REAL system media volume,
 * REAL screen brightness and orientation locking.
 */
@CapacitorPlugin(name = "RsNative")
public class RsNativePlugin extends Plugin {

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void immersive(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) { call.reject("no activity"); return; }
        activity.runOnUiThread(() -> {
            applyImmersive(activity);
            call.resolve();
        });
    }

    /** Hides status/notification bar and navigation bar, sticky (swipe shows them briefly). */
    static void applyImmersive(Activity activity) {
        try {
            Window window = activity.getWindow();
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.setDecorFitsSystemWindows(false);
                WindowInsetsController controller = window.getInsetsController();
                if (controller != null) {
                    controller.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                    controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
            } else {
                window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
            }
        } catch (Exception ignored) {}
    }

    // ------------------------------------------------------------------ volume
    @PluginMethod
    public void getVolume(PluginCall call) {
        try {
            AudioManager am = audio();
            int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            int cur = am.getStreamVolume(AudioManager.STREAM_MUSIC);
            JSObject res = new JSObject();
            res.put("value", max > 0 ? (double) cur / (double) max : 0d);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("volume unavailable");
        }
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Double value = call.getDouble("value", 0d);
        try {
            AudioManager am = audio();
            int max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
            double clamped = Math.max(0d, Math.min(1d, value == null ? 0d : value));
            int target = (int) Math.round(clamped * max);
            am.setStreamVolume(AudioManager.STREAM_MUSIC, target, 0);
            JSObject res = new JSObject();
            res.put("value", max > 0 ? (double) target / (double) max : 0d);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("cannot set volume");
        }
    }

    // -------------------------------------------------------------- brightness
    @PluginMethod
    public void getBrightness(PluginCall call) {
        final Activity activity = getActivity();
        JSObject res = new JSObject();
        try {
            float v = activity.getWindow().getAttributes().screenBrightness;
            if (v < 0) {
                int sys = Settings.System.getInt(getContext().getContentResolver(),
                    Settings.System.SCREEN_BRIGHTNESS, 128);
                v = sys / 255f;
            }
            res.put("value", (double) v);
        } catch (Exception e) {
            res.put("value", 0.5d);
        }
        call.resolve(res);
    }

    @PluginMethod
    public void setBrightness(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) { call.reject("no activity"); return; }
        Double value = call.getDouble("value", 0.5d);
        final float clamped = (float) Math.max(0.01d, Math.min(1d, value == null ? 0.5d : value));
        activity.runOnUiThread(() -> {
            try {
                Window window = activity.getWindow();
                WindowManager.LayoutParams params = window.getAttributes();
                params.screenBrightness = clamped;
                window.setAttributes(params);
                JSObject res = new JSObject();
                res.put("value", (double) clamped);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("cannot set brightness");
            }
        });
    }

    // ------------------------------------------------------------- orientation
    @PluginMethod
    public void lockLandscape(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) { call.reject("no activity"); return; }
        activity.runOnUiThread(() -> {
            activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
            applyImmersive(activity);
            call.resolve();
        });
    }

    @PluginMethod
    public void lockPortrait(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) { call.reject("no activity"); return; }
        activity.runOnUiThread(() -> {
            activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
            call.resolve();
        });
    }

    @PluginMethod
    public void unlockOrientation(final PluginCall call) {
        final Activity activity = getActivity();
        if (activity == null) { call.reject("no activity"); return; }
        activity.runOnUiThread(() -> {
            activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            call.resolve();
        });
    }
}
