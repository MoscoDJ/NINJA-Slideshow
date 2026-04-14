import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:media_kit/media_kit.dart';
import 'package:media_kit_video/media_kit_video.dart';
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
  double _fadeOpacity = 1.0;
  int _imageDuration = 15;

  Player? _player;
  VideoController? _videoController;
  Timer? _imageTimer;
  StreamSubscription? _socketSub;
  StreamSubscription? _playerCompleteSub;
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    _api = ApiService(widget.serverUrl);
    _socket = SocketService(widget.serverUrl);
    _socket.connect();
    _socketSub = _socket.onFilesUpdated.listen((_) => _refresh());
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

      final indexReset =
          _files.isEmpty || files.length != _files.length || _currentIndex >= files.length;

      setState(() {
        _files = files;
        _initialLoading = false;
        if (indexReset) _currentIndex = 0;
      });

      // Start showing content immediately, cache in background
      _startCurrentSlide();
      _cache.syncInBackground(files);
    } catch (e) {
      if (_disposed) return;
      if (_files.isNotEmpty) return;
      setState(() => _initialLoading = false);
    }
  }

  void _startCurrentSlide() {
    _cancelTimers();
    if (_files.isEmpty) return;
    final file = _files[_currentIndex];

    if (file.isVideo) {
      _playVideo(file);
    } else {
      _imageTimer = Timer(Duration(seconds: _imageDuration), _goToNext);
    }
  }

  void _playVideo(SlideFile file) {
    _disposePlayer();

    _player = Player();
    _videoController = VideoController(_player!);

    _playerCompleteSub = _player!.stream.completed.listen((completed) {
      if (completed) _goToNext();
    });

    // Use cached file if available, otherwise stream from URL
    final localPath = _cache.getCachedPath(file);
    final source = (localPath != null && File(localPath).existsSync())
        ? 'file://$localPath'
        : file.url;
    _player!.open(Media(source));

    setState(() {});
  }

  void _goToNext() {
    if (_files.isEmpty || _disposed) return;

    setState(() => _fadeOpacity = 0.0);

    Future.delayed(const Duration(milliseconds: 800), () {
      if (_disposed) return;
      _disposePlayer();
      setState(() {
        _currentIndex = (_currentIndex + 1) % _files.length;
        _fadeOpacity = 1.0;
      });
      _startCurrentSlide();
    });
  }

  void _cancelTimers() {
    _imageTimer?.cancel();
    _imageTimer = null;
  }

  void _disposePlayer() {
    _playerCompleteSub?.cancel();
    _playerCompleteSub = null;
    _player?.dispose();
    _player = null;
    _videoController = null;
  }

  @override
  void dispose() {
    _disposed = true;
    _cancelTimers();
    _disposePlayer();
    _socketSub?.cancel();
    _socket.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: CallbackShortcuts(
        bindings: <ShortcutActivator, VoidCallback>{
          const SingleActivator(LogicalKeyboardKey.escape): widget.onOpenSettings,
          const SingleActivator(LogicalKeyboardKey.keyS): widget.onOpenSettings,
          const SingleActivator(LogicalKeyboardKey.goBack): widget.onOpenSettings,
          const SingleActivator(LogicalKeyboardKey.select): widget.onOpenSettings,
          const SingleActivator(LogicalKeyboardKey.contextMenu): widget.onOpenSettings,
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
              else
                AnimatedOpacity(
                  opacity: _fadeOpacity,
                  duration: const Duration(milliseconds: 800),
                  child: _buildSlide(),
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

  Widget _buildLoading() {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircularProgressIndicator(color: Colors.red),
          SizedBox(height: 16),
          Text(
            'Cargando contenido...',
            style: TextStyle(color: Colors.white54),
          ),
        ],
      ),
    );
  }

  Widget _buildEmpty() {
    return const Center(
      child: Text(
        'No hay contenido disponible',
        style: TextStyle(color: Colors.white54, fontSize: 20),
      ),
    );
  }

  Widget _buildSlide() {
    final file = _files[_currentIndex];

    if (file.isVideo && _videoController != null) {
      return Center(
        child: Video(
          controller: _videoController!,
          fill: Colors.black,
        ),
      );
    }

    // Use cached file if available, otherwise load from network
    final localPath = _cache.getCachedPath(file);
    if (localPath != null && File(localPath).existsSync()) {
      return Image.file(
        File(localPath),
        fit: BoxFit.contain,
        width: double.infinity,
        height: double.infinity,
        errorBuilder: (_, error, stack) => _buildNetworkImage(file),
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
          child: CircularProgressIndicator(color: Colors.red),
        );
      },
      errorBuilder: (_, error, stack) => const Center(
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
