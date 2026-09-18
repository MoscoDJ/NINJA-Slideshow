import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:video_player/video_player.dart';
import '../models/slide_file.dart';
import '../services/api_service.dart';
import '../services/cache_service.dart';
import '../services/settings_service.dart';
import '../services/socket_service.dart';

class SlideshowScreen extends StatefulWidget {
  final String serverUrl;
  final VoidCallback onOpenSettings;

  const SlideshowScreen({
    super.key,
    required this.serverUrl,
    required this.onOpenSettings,
  });

  @override
  State<SlideshowScreen> createState() => _SlideshowScreenState();
}

class _SlideshowScreenState extends State<SlideshowScreen> {
  late final ApiService _api;
  late final SocketService _socket;
  final CacheService _cache = CacheService();

  List<SlideFile> _files = [];
  int _currentIndex = 0;
  bool _initialLoading = true;
  bool _playingVideo = false;
  double _fadeOpacity = 1.0;
  /// Progreso de la barra. Es un ValueNotifier para que sus cambios (hasta
  /// 10 Hz en imagen, 4 Hz en video) NO reconstruyan el Stack ni la textura
  /// de video: cada rebuild sobre la textura costaba memoria grafica que el
  /// driver Mali de este Chromecast no libera.
  final ValueNotifier<double> _progress = ValueNotifier<double>(0.0);
  Timer? _videoProgressTimer;
  int _imageDuration = 15;

  /// true cuando el ultimo fetch fallo y aun no hay contenido: distingue
  /// "servidor inalcanzable" de "el servidor dice que no hay archivos".
  bool _serverUnreachable = false;
  int _retryDelaySeconds = 5;

  Timer? _imageTimer;
  Timer? _progressTimer;
  Timer? _retryTimer;
  Timer? _pollTimer;
  StreamSubscription? _socketSub;
  bool _disposed = false;
  DateTime? _slideStartTime;

  // Video en la propia app (Android/otros): ExoPlayer via video_player.
  VideoPlayerController? _videoController;
  bool _videoFinishing = false;

  // Video externo con mpv: SOLO en Linux (Raspberry Pi), donde media_kit no
  // funciona sobre la GPU VideoCore. En Android no existe mpv.
  Process? _mpvProcess;
  bool get _useExternalMpv => Platform.isLinux;

  /// Sondeo de seguridad: aunque el socket este caido, la lista se refresca
  /// sola. Las apps de TV hacen lo mismo cada 30 s.
  static const _pollInterval = Duration(seconds: 60);
  static const _maxRetryDelaySeconds = 60;

  @override
  void initState() {
    super.initState();
    _api = ApiService(widget.serverUrl);
    _socket = SocketService(widget.serverUrl);
    _socket.connect();
    _socketSub = _socket.onFilesUpdated.listen((_) => _refresh());
    _pollTimer = Timer.periodic(_pollInterval, (_) => _refresh());
    _init();
  }

  Future<void> _init() async {
    _imageDuration = await SettingsService.getImageDuration();
    await _cache.init();
    await _refresh();
  }

  Future<void> _refresh() async {
    try {
      final files = await _api.fetchFiles();
      if (_disposed) return;

      _retryTimer?.cancel();
      _retryTimer = null;
      _retryDelaySeconds = 5;

      final indexReset = _files.isEmpty ||
          files.length != _files.length ||
          _currentIndex >= files.length;
      final wasEmpty = _files.isEmpty;

      setState(() {
        _files = files;
        _initialLoading = false;
        _serverUnreachable = false;
        if (indexReset) _currentIndex = 0;
      });

      // Solo re-arrancar el slide actual si la lista cambio de forma; si no,
      // un refresco periodico interrumpiria la imagen/video en curso.
      if (wasEmpty || indexReset) _startCurrentSlide();
      _cache.syncInBackground(files);
    } catch (e) {
      if (_disposed) return;
      // Con contenido ya cargado seguimos mostrandolo; el sondeo reintentara.
      if (_files.isNotEmpty) return;

      // Sin contenido: no quedarse atorado. Reintentar con backoff.
      setState(() {
        _initialLoading = false;
        _serverUnreachable = true;
      });
      _scheduleRetry();
    }
  }

  void _scheduleRetry() {
    _retryTimer?.cancel();
    _retryTimer = Timer(Duration(seconds: _retryDelaySeconds), () {
      if (_disposed) return;
      _refresh();
    });
    _retryDelaySeconds =
        (_retryDelaySeconds * 2).clamp(5, _maxRetryDelaySeconds);
  }

  void _startCurrentSlide() {
    _cancelAllTimers();
    _disposeVideo();
    if (_files.isEmpty) return;
    final file = _files[_currentIndex];
    _slideStartTime = DateTime.now();
    _progress.value = 0.0;

    if (file.isVideo) {
      if (_useExternalMpv) {
        _playVideoExternal(file);
      } else {
        _playVideoInApp(file);
      }
    } else {
      setState(() => _playingVideo = false);
      _imageTimer = Timer(Duration(seconds: _imageDuration), _goToNext);
      _startImageProgressTicker();
    }
  }

  void _startImageProgressTicker() {
    _progressTimer?.cancel();
    _progressTimer = Timer.periodic(const Duration(milliseconds: 100), (_) {
      if (_slideStartTime == null || _disposed) return;
      final elapsed =
          DateTime.now().difference(_slideStartTime!).inMilliseconds;
      final total = _imageDuration * 1000;
      _progress.value = (elapsed / total).clamp(0.0, 1.0);
    });
  }

  // ---------------------------------------------------------------------
  // Video en la app (Android TV / Google TV)
  // ---------------------------------------------------------------------

  Future<void> _playVideoInApp(SlideFile file) async {
    final localPath = _cache.getCachedPath(file);
    // textureView (default). Se probo platformView (1.4.4): misma fuga de
    // memoria y las capturas durante video salian negras, asi que se revirtio.
    // La fuga en si sigue abierta; ver README, "Fuga de memoria en Android TV".
    final controller = (localPath != null && File(localPath).existsSync())
        ? VideoPlayerController.file(File(localPath))
        : VideoPlayerController.networkUrl(Uri.parse(file.url));

    _videoController = controller;
    _videoFinishing = false;
    _progress.value = 0.0;
    setState(() => _playingVideo = true);

    try {
      await controller.initialize();
      if (_disposed || _videoController != controller) {
        await controller.dispose();
        return;
      }
      // Pantalla de senalizacion: sin audio, como en las apps de TV.
      await controller.setVolume(0);
      await controller.setLooping(false);
      // Un solo rebuild al quedar lista la textura; despues, ninguno por frame.
      controller.addListener(_onVideoTick);
      await controller.play();
      if (mounted) setState(() {});
      _videoProgressTimer?.cancel();
      _videoProgressTimer = Timer.periodic(const Duration(milliseconds: 250), (_) {
        final v = _videoController?.value;
        if (v == null || !v.isInitialized || v.duration <= Duration.zero) return;
        _progress.value =
            (v.position.inMilliseconds / v.duration.inMilliseconds).clamp(0.0, 1.0);
      });
    } catch (e) {
      // Archivo corrupto, codec no soportado o red caida: no bloquear el
      // carrusel. Pequena espera para no entrar en bucle cerrado.
      if (_disposed || _videoController != controller) return;
      await Future.delayed(const Duration(seconds: 2));
      if (_disposed) return;
      _finishVideo();
    }
  }

  /// Solo error y fin. Nada de setState aqui: el reproductor notifica hasta
  /// 60 veces por segundo y reconstruir la textura en cada una es lo que
  /// fugaba memoria grafica.
  void _onVideoTick() {
    final v = _videoController?.value;
    if (v == null || _disposed) return;
    if (v.hasError || v.isCompleted) _finishVideo();
  }

  void _finishVideo() {
    if (_videoFinishing) return;
    _videoFinishing = true;
    _disposeVideo();
    if (_disposed) return;
    setState(() => _playingVideo = false);
    _goToNext();
  }

  void _disposeVideo() {
    _videoProgressTimer?.cancel();
    _videoProgressTimer = null;
    final c = _videoController;
    _videoController = null;
    if (c != null) {
      c.removeListener(_onVideoTick);
      c.dispose();
    }
  }

  // ---------------------------------------------------------------------
  // Video externo con mpv (solo Linux / Raspberry Pi)
  // ---------------------------------------------------------------------

  Future<void> _playVideoExternal(SlideFile file) async {
    final localPath = _cache.getCachedPath(file);
    final source = (localPath != null && File(localPath).existsSync())
        ? localPath
        : file.url;

    _progress.value = 0.0;
    setState(() => _playingVideo = true);

    try {
      _mpvProcess = await Process.start('mpv', [
        '--fullscreen',
        '--no-terminal',
        '--really-quiet',
        '--no-input-default-bindings',
        '--keep-open=no',
        source,
      ]);
      await _mpvProcess!.exitCode;
    } catch (_) {
      await Future.delayed(const Duration(seconds: 2));
    }

    _mpvProcess = null;
    if (_disposed) return;
    setState(() => _playingVideo = false);
    _goToNext();
  }

  void _killMpv() {
    _mpvProcess?.kill();
    _mpvProcess = null;
  }

  // ---------------------------------------------------------------------

  void _goToNext() {
    if (_files.isEmpty || _disposed) return;

    _cancelAllTimers();
    setState(() => _fadeOpacity = 0.0);

    Future.delayed(const Duration(milliseconds: 800), () {
      if (_disposed) return;
      _progress.value = 0.0;
      setState(() {
        _currentIndex = (_currentIndex + 1) % _files.length;
        _fadeOpacity = 1.0;
      });
      _startCurrentSlide();
    });
  }

  void _cancelAllTimers() {
    _imageTimer?.cancel();
    _imageTimer = null;
    _progressTimer?.cancel();
    _progressTimer = null;
  }

  @override
  void dispose() {
    _disposed = true;
    _cancelAllTimers();
    _retryTimer?.cancel();
    _pollTimer?.cancel();
    _disposeVideo();
    _killMpv();
    _progress.dispose();
    _socketSub?.cancel();
    _socket.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Con mpv el video se dibuja fuera de Flutter, encima de la ventana: no
    // hay nada que pintar ni barra que mostrar. En la app si.
    final externalVideoActive = _playingVideo && _useExternalMpv;

    return Scaffold(
      backgroundColor: Colors.black,
      body: CallbackShortcuts(
        bindings: <ShortcutActivator, VoidCallback>{
          const SingleActivator(LogicalKeyboardKey.escape): _openSettings,
          const SingleActivator(LogicalKeyboardKey.keyS): _openSettings,
          const SingleActivator(LogicalKeyboardKey.goBack): _openSettings,
        },
        child: Focus(
          autofocus: true,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (_initialLoading)
                _buildLoading()
              else if (_files.isEmpty)
                _buildEmpty()
              else if (externalVideoActive)
                const SizedBox.expand()
              else if (_playingVideo)
                // Sin AnimatedOpacity alrededor de la textura: una capa de
                // opacidad sobre una textura de plataforma la manda offscreen
                // en cada frame, y este driver no devuelve esa memoria.
                _buildVideo()
              else
                AnimatedOpacity(
                  opacity: _fadeOpacity,
                  duration: const Duration(milliseconds: 800),
                  child: _buildSlide(),
                ),
              // Fundido del video como velo negro ENCIMA (barato).
              if (_playingVideo)
                IgnorePointer(
                  child: AnimatedOpacity(
                    opacity: 1.0 - _fadeOpacity,
                    duration: const Duration(milliseconds: 800),
                    child: const ColoredBox(color: Colors.black),
                  ),
                ),
              if (!externalVideoActive)
                Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  child: ValueListenableBuilder<double>(
                    valueListenable: _progress,
                    builder: (context, value, child) => LinearProgressIndicator(
                      value: value,
                      minHeight: 3,
                      backgroundColor: Colors.black26,
                      valueColor: const AlwaysStoppedAnimation<Color>(
                          Color(0xFFEC1C24)),
                    ),
                  ),
                ),
              Positioned(
                top: 8,
                right: 8,
                child: _buildStatusDot(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _openSettings() {
    _killMpv();
    _disposeVideo();
    widget.onOpenSettings();
  }

  Widget _buildLoading() {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(color: Colors.red),
          SizedBox(height: 16),
          Text('Cargando contenido...',
              style: TextStyle(color: Colors.white54)),
        ],
      ),
    );
  }

  Widget _buildEmpty() {
    // No confundir "sin red" con "sin archivos": en el primer caso se esta
    // reintentando solo y la pantalla no se queda atorada.
    if (_serverUnreachable) {
      return const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: Colors.red),
            SizedBox(height: 16),
            Text('Sin conexion con el servidor. Reintentando...',
                style: TextStyle(color: Colors.white54, fontSize: 20)),
          ],
        ),
      );
    }
    return const Center(
      child: Text('No hay contenido disponible',
          style: TextStyle(color: Colors.white54, fontSize: 20)),
    );
  }

  Widget _buildVideo() {
    final c = _videoController;
    if (c == null || !c.value.isInitialized) {
      return const Center(child: CircularProgressIndicator(color: Colors.red));
    }
    return Center(
      child: AspectRatio(
        aspectRatio: c.value.aspectRatio,
        child: VideoPlayer(c),
      ),
    );
  }

  Widget _buildSlide() {
    final file = _files[_currentIndex];

    final localPath = _cache.getCachedPath(file);
    if (localPath != null && File(localPath).existsSync()) {
      return Image.file(
        File(localPath),
        fit: BoxFit.contain,
        width: double.infinity,
        height: double.infinity,
        errorBuilder: (_, e, s) => _buildNetworkImage(file),
      );
    }

    return _buildNetworkImage(file);
  }

  Widget _buildNetworkImage(SlideFile file) {
    return Image.network(
      file.url,
      fit: BoxFit.contain,
      width: double.infinity,
      height: double.infinity,
      loadingBuilder: (_, child, progress) {
        if (progress == null) return child;
        return const Center(
            child: CircularProgressIndicator(color: Colors.red));
      },
      errorBuilder: (_, e, s) => const Center(
        child: Icon(Icons.broken_image, color: Colors.white24, size: 64),
      ),
    );
  }

  Widget _buildStatusDot() {
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: _socket.isConnected ? Colors.green : Colors.red,
      ),
    );
  }
}
