package mx.com.ninja.slideshow

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Auto-arranque en señalización: al encender la pantalla, relanza el slideshow
 * sin que nadie toque el control. Pensado para el Chromecast con Google TV del
 * pasillo, que tras un apagado total cae al home en vez de a la app.
 *
 * En Android 10+ el "background activity launch" puede bloquear el
 * startActivity desde un receiver. En dispositivos de TV suele permitirse en el
 * arranque; si el fabricante lo bloquea, el fallback es fijar esta app como
 * launcher HOME (ver README).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_LOCKED_BOOT_COMPLETED,
            "android.intent.action.QUICKBOOT_POWERON",
            "com.htc.intent.action.QUICKBOOT_POWERON" -> {
                Log.i("NinjaBoot", "boot recibido (${intent.action}), lanzando slideshow")
                val launch = Intent(context, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                }
                try {
                    context.startActivity(launch)
                } catch (e: Exception) {
                    Log.e("NinjaBoot", "no se pudo lanzar: ${e.message}")
                }
            }
        }
    }
}
