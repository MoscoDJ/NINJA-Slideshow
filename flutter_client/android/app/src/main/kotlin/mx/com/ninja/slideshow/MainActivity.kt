package mx.com.ninja.slideshow

import android.os.Bundle
import android.view.WindowManager
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Senalizacion: la pantalla no debe apagarse mientras la app este
        // visible. `android:keepScreenOn` en <application> del manifest NO es
        // un atributo valido ahi (es de View/Window) y Android lo ignoraba en
        // silencio: en Google TV, con screen_off_timeout de 10 min, la pantalla
        // del pasillo se apagaba cada 10 min sin control remoto.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
