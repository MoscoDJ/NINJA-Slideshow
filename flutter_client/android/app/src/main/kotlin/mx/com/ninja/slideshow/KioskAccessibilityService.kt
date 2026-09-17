package mx.com.ninja.slideshow

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityEvent

/**
 * Modo kiosco para señalización en Google TV.
 *
 * Google TV bloquea el auto-arranque por BOOT_COMPLETED (restriccion BAL de
 * Android 14) y no respeta un launcher HOME de terceros. Un servicio de
 * accesibilidad si puede: el sistema lo inicia en el arranque y esta exento de
 * la restriccion BAL, asi que cuando la pantalla cae al launcher lo detecta y
 * relanza el slideshow.
 *
 * Acotado a proposito:
 *  - Solo reacciona cuando el LAUNCHER pasa a primer plano; no interfiere con
 *    Ajustes, el dialogo de emparejamiento ni otras apps.
 *  - No pide canRetrieveWindowContent: solo lee que paquete esta al frente, no
 *    el contenido de la pantalla.
 */
class KioskAccessibilityService : AccessibilityService() {

    private var lastRelaunch = 0L

    // Launchers de Google TV / Android TV desde los que rebotamos al slideshow.
    private val homePackages = setOf(
        "com.google.android.apps.tv.launcherx",
        "com.google.android.tvlauncher",
        "com.google.android.apps.tv.launcher",
    )

    override fun onServiceConnected() {
        // Si al conectar (p. ej. recien arrancado) ya estamos en el launcher,
        // relanzar de inmediato en vez de esperar al siguiente evento.
        relaunchSlideshow("service-connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        if (pkg in homePackages) {
            relaunchSlideshow("home:$pkg")
        }
    }

    private fun relaunchSlideshow(reason: String) {
        // Antirrebote: evita relanzar en bucle cerrado.
        val now = SystemClock.elapsedRealtime()
        if (now - lastRelaunch < 3000) return
        lastRelaunch = now

        val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        if (launch != null) {
            Log.i("NinjaKiosk", "relanzando slideshow ($reason)")
            try {
                startActivity(launch)
            } catch (e: Exception) {
                Log.e("NinjaKiosk", "no se pudo relanzar: ${e.message}")
            }
        }
    }

    override fun onInterrupt() {}
}
